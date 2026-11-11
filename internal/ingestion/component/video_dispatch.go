//
// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Video dispatch: ffmpeg extracts the audio track for speech-to-text and a
// sparse set of key frames for an IMAGE2TEXT caption. Both carry a timestamp,
// so the two sources merge into one time-ordered transcript that reads as the
// video's indexed text.
//
// A provider-native video input is deliberately not used: OpenAI-compatible
// drivers only accept image_url and Gemini's parts only accept text/image_url,
// so a video_url block is silently dropped. Extracting locally keeps one code
// path for every provider.

package component

import (
	"context"
	"encoding/base64"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"gorm.io/gorm"

	"ragflow/internal/ingestion/component/schema"
	"ragflow/internal/parser/parser"
	"ragflow/internal/utility"
)

const (
	// maxVideoBytes bounds the payload handed to ffmpeg. The binary is already
	// in memory when this check runs, so the limit only guards the disk copy
	// and keeps an accidentally huge upload from filling the temp volume.
	maxVideoBytes = 512 << 20

	// videoFrameIntervalSeconds is the default gap between key frames. A long
	// recording raises it so the whole video stays covered within maxVideoFrames.
	videoFrameIntervalSeconds = 10

	// maxVideoFrames bounds the vision-model calls one video can trigger.
	maxVideoFrames = 20

	// videoFrameWidth caps a frame's width; -2 keeps the aspect ratio and the
	// min() expression keeps a smaller source at its own size.
	videoFrameWidth = 1280

	// videoFrameConcurrency bounds simultaneous vision-model calls.
	videoFrameConcurrency = 4

	// videoFrameJPEGQuality is ffmpeg's -q:v value (2 is best, 31 is worst).
	videoFrameJPEGQuality = 3

	// videoAudioSampleRate is the 16kHz mono rate speech models expect.
	videoAudioSampleRate = 16000
)

// videoPart is one line of the merged transcript: a timestamped sentence or a
// timestamped key-frame caption.
type videoPart struct {
	StartMS int64
	Text    string
}

func maybeDispatchVideo(
	ctx context.Context,
	db *gorm.DB,
	fileType utility.FileType,
	filename string,
	binary []byte,
	inputs map[string]any,
	setups map[string]schema.ParserSetup,
	vision visionSettings,
) (parser.ParseResult, bool, error) {
	if fileType != utility.FileTypeVIDEO {
		return parser.ParseResult{}, false, nil
	}
	setup, ok := setups["video"]
	if !ok {
		return parser.ParseResult{}, false, nil
	}
	tenantID := getStringOr(inputs, "tenant_id", "")
	if tenantID == "" {
		return parser.ParseResult{}, true, fmt.Errorf("parser: video requires tenant_id")
	}
	if len(binary) == 0 {
		return parser.ParseResult{}, true, fmt.Errorf("parser: video payload is empty")
	}
	if len(binary) > maxVideoBytes {
		return parser.ParseResult{}, true,
			fmt.Errorf("parser: video payload is %d bytes, above the %d-byte limit", len(binary), maxVideoBytes)
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return parser.ParseResult{}, true,
			fmt.Errorf("Parser: video parsing requires ffmpeg on PATH: %w", err)
	}
	workDir, err := os.MkdirTemp("", "ragflow_video_*")
	if err != nil {
		return parser.ParseResult{}, true, fmt.Errorf("parser: video temp dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	source := filepath.Join(workDir, "source"+videoFileExtension(filename))
	if err := os.WriteFile(source, binary, 0o600); err != nil {
		return parser.ParseResult{}, true, fmt.Errorf("parser: video temp file: %w", err)
	}

	var warnings []string
	audioParts, audioWarnings, audioErr := transcribeVideoAudio(ctx, db, ffmpeg, workDir, source, tenantID, setup)
	warnings = append(warnings, audioWarnings...)
	if audioErr != nil {
		warnings = append(warnings, fmt.Sprintf("video audio unavailable: %v", audioErr))
	}

	frameParts, frameWarnings, frameErr := describeVideoFrames(ctx, db, ffmpeg, workDir, source, tenantID, setup, inputs, vision)
	warnings = append(warnings, frameWarnings...)
	if frameErr != nil {
		warnings = append(warnings, fmt.Sprintf("video key frames unavailable: %v", frameErr))
	}

	parts := append(audioParts, frameParts...)
	if len(parts) == 0 {
		switch {
		case audioErr != nil && frameErr != nil:
			return parser.ParseResult{}, true,
				fmt.Errorf("Parser: video parsing produced no text: audio: %v; key frames: %v", audioErr, frameErr)
		case audioErr != nil:
			return parser.ParseResult{}, true, fmt.Errorf("Parser: video audio transcription failed: %w", audioErr)
		case frameErr != nil:
			return parser.ParseResult{}, true, fmt.Errorf("Parser: video key-frame description failed: %w", frameErr)
		}
		return parser.ParseResult{}, true,
			fmt.Errorf("Parser: video contained no recognisable speech and no describable key frames")
	}

	return parser.ParseResult{
		OutputFormat: "json",
		JSON:         []parser.DocItem{parser.NewTextJSONItem(mergeVideoParts(parts))},
		Warnings:     warnings,
	}, true, nil
}

// mergeVideoParts renders speech sentences and key-frame captions as one
// time-ordered transcript. Each line is prefixed with its position on the
// video timeline so the chunker can keep the two sources aligned.
func mergeVideoParts(parts []videoPart) string {
	ordered := make([]videoPart, len(parts))
	copy(ordered, parts)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].StartMS < ordered[j].StartMS })
	lines := make([]string, 0, len(ordered))
	for _, part := range ordered {
		lines = append(lines, fmt.Sprintf("[%s] %s", formatVideoTimestamp(part.StartMS), part.Text))
	}
	return strings.Join(lines, "\n")
}

// transcribeVideoAudio extracts the audio track as 16kHz mono PCM and sends it
// through the same speech-to-text path the audio family uses.
func transcribeVideoAudio(
	ctx context.Context,
	db *gorm.DB,
	ffmpeg string,
	workDir string,
	source string,
	tenantID string,
	setup schema.ParserSetup,
) ([]videoPart, []string, error) {
	audioPath := filepath.Join(workDir, "audio.wav")
	args := []string{
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-i", source,
		"-vn", "-ac", "1", "-ar", strconv.Itoa(videoAudioSampleRate),
		"-c:a", "pcm_s16le", audioPath,
	}
	if err := runFFmpeg(ctx, ffmpeg, args...); err != nil {
		return nil, nil, fmt.Errorf("extract audio track: %w", err)
	}
	// A 44-byte WAV is a header with no frames: the container has no audio
	// stream (or a silent one), and ffmpeg still succeeds.
	if info, err := os.Stat(audioPath); err != nil || info.Size() <= 44 {
		return nil, []string{"video audio: the video has no audio track"}, nil
	}

	asrModel, err := resolveASRModel(ctx, db, tenantID, setup, "video dispatch")
	if err != nil {
		return nil, nil, fmt.Errorf("speech-to-text model: %w", err)
	}
	resp, err := asrModel.Transcribe(ctx, &audioPath, nil, nil)
	if err != nil {
		if isASRNoSpeechError(err) {
			return nil, []string{"video audio: no recognisable speech"}, nil
		}
		return nil, nil, err
	}
	if resp == nil {
		return nil, []string{"video audio: the speech model returned no result"}, nil
	}

	parts := make([]videoPart, 0, len(resp.Sentences))
	for _, sentence := range resp.Sentences {
		if text := strings.TrimSpace(sentence.Text); text != "" {
			parts = append(parts, videoPart{StartMS: sentence.BeginMS, Text: text})
		}
	}
	if len(parts) > 0 {
		return parts, nil, nil
	}
	if text := strings.TrimSpace(resp.Text); text != "" {
		return []videoPart{{Text: text}}, nil, nil
	}
	return nil, []string{"video audio: the speech model returned no text"}, nil
}

// describeVideoFrames samples key frames and describes each one with the
// vision model. Frame k is sampled at k*interval, so its caption lands on the
// video timeline and interleaves with the transcript.
func describeVideoFrames(
	ctx context.Context,
	db *gorm.DB,
	ffmpeg string,
	workDir string,
	source string,
	tenantID string,
	setup schema.ParserSetup,
	inputs map[string]any,
	vision visionSettings,
) ([]videoPart, []string, error) {
	driver, modelName, apiConfig, err := resolveVisionModelConfig(ctx, db, tenantID, vision.modelID, "video dispatch")
	if err != nil {
		return nil, nil, fmt.Errorf("vision model: %w", err)
	}

	interval := videoFrameIntervalSeconds
	if duration, ok := probeVideoDuration(ctx, source); ok {
		interval = videoFrameInterval(duration)
	}
	frames, err := extractVideoFrames(ctx, ffmpeg, workDir, source, interval)
	if err != nil {
		return nil, nil, err
	}
	if len(frames) == 0 {
		return nil, []string{"video key frames: the video has no video stream"}, nil
	}

	prompt := strings.TrimSpace(getStringOr(setup, "prompt", ""))
	if prompt == "" {
		prompt = defaultVideoVisionPrompt(resolveVisionLanguage(inputs))
	}
	label := videoFrameLabel(resolveVisionLanguage(inputs))

	captions := make([]string, len(frames))
	errs := make([]error, len(frames))
	sem := make(chan struct{}, videoFrameConcurrency)
	var wg sync.WaitGroup
	for i, frame := range frames {
		wg.Add(1)
		go func(i int, frame string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			data, readErr := os.ReadFile(frame)
			if readErr != nil {
				errs[i] = readErr
				return
			}
			caption, chatErr := describeWithVision(ctx, driver, modelName, apiConfig, videoFrameDataURI(data), prompt)
			captions[i] = caption
			errs[i] = chatErr
		}(i, frame)
	}
	wg.Wait()

	var warnings []string
	parts := make([]videoPart, 0, len(frames))
	failures := 0
	for i, caption := range captions {
		switch {
		case errs[i] != nil:
			failures++
		case strings.TrimSpace(caption) == "":
			continue
		default:
			parts = append(parts, videoPart{
				StartMS: int64(i) * int64(interval) * 1000,
				Text:    label + ": " + caption,
			})
		}
	}
	if failures > 0 {
		warnings = append(warnings, fmt.Sprintf("video key frames: %d of %d captions failed", failures, len(frames)))
	}
	if len(parts) == 0 {
		if failures == len(frames) {
			return nil, warnings, fmt.Errorf("all %d key-frame captions failed: %w", len(frames), errs[0])
		}
		return nil, warnings, fmt.Errorf("the vision model returned no caption for %d key frames", len(frames))
	}
	return parts, warnings, nil
}

// videoFrameInterval picks the gap between key frames. Short videos keep the
// default; a long recording raises it so maxVideoFrames still covers the whole
// timeline instead of stopping early.
func videoFrameInterval(durationSeconds float64) int {
	if durationSeconds <= 0 {
		return videoFrameIntervalSeconds
	}
	if needed := int(math.Ceil(durationSeconds / maxVideoFrames)); needed > videoFrameIntervalSeconds {
		return needed
	}
	return videoFrameIntervalSeconds
}

// extractVideoFrames writes JPEG key frames into the work directory. The
// filter samples one frame every interval seconds, caps the width, and the
// frame count is bounded so a long recording cannot flood the vision model.
func extractVideoFrames(
	ctx context.Context,
	ffmpeg string,
	workDir string,
	source string,
	intervalSeconds int,
) ([]string, error) {
	frameDir := filepath.Join(workDir, "frames")
	if err := os.MkdirAll(frameDir, 0o700); err != nil {
		return nil, fmt.Errorf("create frame directory: %w", err)
	}
	pattern := filepath.Join(frameDir, "frame_%04d.jpg")
	filter := fmt.Sprintf("fps=1/%d,scale=w=min(%d\\,iw):h=-2", intervalSeconds, videoFrameWidth)
	args := []string{
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-i", source,
		"-vf", filter,
		"-frames:v", strconv.Itoa(maxVideoFrames),
		"-q:v", strconv.Itoa(videoFrameJPEGQuality),
		pattern,
	}
	if err := runFFmpeg(ctx, ffmpeg, args...); err != nil {
		return nil, fmt.Errorf("extract key frames: %w", err)
	}
	entries, err := os.ReadDir(frameDir)
	if err != nil {
		return nil, fmt.Errorf("read frame directory: %w", err)
	}
	frames := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".jpg") {
			frames = append(frames, filepath.Join(frameDir, entry.Name()))
		}
	}
	return frames, nil
}

// probeVideoDuration reads the container duration with ffprobe. It is optional:
// when ffprobe is absent the caller keeps the default frame interval.
func probeVideoDuration(ctx context.Context, source string) (float64, bool) {
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		return 0, false
	}
	cmd := exec.CommandContext(ctx, ffprobe,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		source,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, false
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || seconds <= 0 {
		return 0, false
	}
	return seconds, true
}

func runFFmpeg(ctx context.Context, ffmpeg string, args ...string) error {
	output, err := exec.CommandContext(ctx, ffmpeg, args...).CombinedOutput()
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if message := strings.TrimSpace(string(output)); message != "" {
			return fmt.Errorf("%w: %s", err, message)
		}
	}
	return err
}

// videoFrameDataURI wraps a JPEG frame in the only image form vision drivers
// accept.
func videoFrameDataURI(jpeg []byte) string {
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpeg)
}

// videoFrameLabel marks a caption line so a reader can tell a described key
// frame from spoken text.
func videoFrameLabel(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "chinese", "zh", "zh-cn", "zh-hans", "中文":
		return "画面"
	}
	return "Frame"
}

// formatVideoTimestamp renders a millisecond offset as HH:MM:SS.
func formatVideoTimestamp(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	total := ms / 1000
	return fmt.Sprintf("%02d:%02d:%02d", total/3600, (total%3600)/60, total%60)
}

func videoFileExtension(filename string) string {
	if ext := strings.ToLower(filepath.Ext(filename)); ext != "" {
		return ext
	}
	return ".mp4"
}
