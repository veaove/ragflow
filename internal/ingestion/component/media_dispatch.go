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

// Media dispatch runs image OCR and optional vision enhancement, audio
// transcription, and video dispatch at the component layer.

package component

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"go.uber.org/zap"

	"ragflow/internal/common"
	deepdocpdf "ragflow/internal/deepdoc/parser/pdf"
	"ragflow/internal/entity"
	modelModule "ragflow/internal/entity/models"
	"ragflow/internal/ingestion/component/progress"
	"ragflow/internal/ingestion/component/schema"
	"ragflow/internal/parser/parser"
	"ragflow/internal/utility"

	"gorm.io/gorm"
)

// Video dispatch: IMAGE2TEXT vision chat ---

func maybeDispatchVideo(
	ctx context.Context,
	db *gorm.DB,
	fileType utility.FileType,
	filename string,
	binary []byte,
	inputs map[string]any,
	setups map[string]schema.ParserSetup,
) (parser.ParseResult, bool, error) {
	if fileType != utility.FileTypeVIDEO {
		return parser.ParseResult{}, false, nil
	}
	if _, ok := setups["video"]; !ok {
		return parser.ParseResult{}, false, nil
	}

	// Video parsing is intentionally not implemented yet: the underlying
	// video-analysis capability is pending. The previously-shipped path sent a
	// video_url data URI, but no model driver honors it — OpenAI-compatible
	// drivers only accept image_url (the block is ignored), and Gemini's
	// googleMessageParts only accepts text/image_url and silently drops
	// video_url. Returning an explicit error is safer than silently producing
	// a description from the prompt text alone. The real implementation must
	// be provider-specific (OpenAI-compatible: frame extraction -> image_url;
	// Gemini: raw-bytes inline_data; Qwen: file://).
	// When video analysis is implemented, it emits standard Text JSON items:
	// [{"text": transcript, "doc_type_kwd": "text"}] with output_format "json".
	return parser.ParseResult{}, true,
		fmt.Errorf("Parser: video parsing is not yet supported; underlying video analysis capability is pending")
}

// Image dispatch: OCR, or the document text of an SVG, followed by optional
// IMAGE2TEXT enhancement.

func maybeDispatchImage(
	ctx context.Context,
	db *gorm.DB,
	fileType utility.FileType,
	filename string,
	binary []byte,
	inputs map[string]any,
	setups map[string]schema.ParserSetup,
	enableVisionEnhancement bool,
	vision visionSettings,
) (parser.ParseResult, bool, error) {
	if fileType != utility.FileTypeVISUAL {
		return parser.ParseResult{}, false, nil
	}
	setup, ok := setups["image"]
	if !ok {
		return parser.ParseResult{}, false, nil
	}
	method := getStringOr(setup, "parse_method", "")
	_, hasOCRFlag := setup["ocr_enabled"].(bool)
	// ocr_enabled is the OCR switch. Legacy setups omit it and encode the same
	// choice in parse_method: "ocr"/empty selects local OCR, any other value is
	// a VLM model reference that also implies OCR is off. The selection itself
	// lives in imageSetupRunsOCR (parser.go), shared with Check().
	useOCR := imageSetupRunsOCR(setup)
	release, err := parser.AcquireImageMedia(ctx)
	if err != nil {
		return parser.ParseResult{}, true, err
	}
	defer release()
	if len(binary) == 0 || len(binary) > parser.MaxImagePayloadBytes {
		return parser.ParseResult{}, true, fmt.Errorf("parser: image payload exceeds size limits")
	}
	// SVG carries its text in the document, so it is read rather than
	// rasterized for OCR, whatever the OCR switch says.
	isSVG := isSVGFilename(filename)
	var text string
	var ocrErr error
	if isSVG {
		text, err = extractSVGText(ctx, binary)
		if err != nil {
			return parser.ParseResult{}, true, err
		}
	} else {
		img, err := decodeDispatchImage(binary, useOCR)
		if err != nil {
			return parser.ParseResult{}, true, err
		}
		if useOCR {
			text, ocrErr = extractImageText(ctx, img)
		}
	}
	release()
	parsed := dispatchParse(ctx, fileType, filename, binary, setups, progress.Window{})
	if parsed.Err != nil {
		return parsed, true, parsed.Err
	}
	if len(parsed.JSON) == 0 {
		return parsed, true, fmt.Errorf("parser: image parser returned no image item")
	}
	parsed.OutputFormat = "json"
	imageData, _ := parsed.JSON[0].ToMap()["image"].(string)
	m := parsed.JSON[0].ToMap()
	m["text"] = text
	parsed.JSON[0] = parser.DocItemFromMap(m)
	if ocrErr != nil {
		parsed.Warnings = append(parsed.Warnings, fmt.Sprintf("image OCR unavailable: %v", ocrErr))
	} else if isSVG && text == "" {
		parsed.Warnings = append(parsed.Warnings, "image SVG contains no text")
	} else if useOCR && strings.TrimSpace(text) == "" {
		parsed.Warnings = append(parsed.Warnings, "image OCR returned no text")
	}
	if !useOCR && !enableVisionEnhancement {
		// Neither text source is enabled: local OCR is off and the vision
		// description is not permitted. The item still carries the image, but the
		// Tokenizer's retrievability filter drops chunks that have no text and no
		// surrounding context, so this document indexes nothing. Say so instead of
		// silently returning an empty result.
		parsed.Warnings = append(parsed.Warnings,
			"image has no text source: OCR is off and vision enhancement is disabled, so the Tokenizer will discard this item")
	}
	if err := ctx.Err(); err != nil {
		return parsed, true, err
	}
	if enableVisionEnhancement && isSVG {
		// Vision providers take raster images; raw SVG is not sent to them.
		parsed.Warnings = append(parsed.Warnings, "image VLM enhancement skipped: SVG is not rasterized for vision models")
	} else if enableVisionEnhancement {
		// A setup with an explicit ocr_enabled switch always uses the global
		// vision settings. Only legacy setups (no switch) carry the VLM model
		// reference in parse_method, which also disabled OCR by construction.
		imageVision := vision
		if !hasOCRFlag && !useOCR {
			imageVision.modelID = method
		}
		description, warnings := describeImage(ctx, db, imageData, getStringOr(inputs, "tenant_id", ""), setup, inputs, imageVision)
		parsed.Warnings = append(parsed.Warnings, warnings...)
		if description != "" {
			m := parsed.JSON[0].ToMap()
			appendItemText(m, description)
			parsed.JSON[0] = parser.DocItemFromMap(m)
		} else if strings.TrimSpace(text) == "" {
			// Enhancement was permitted and the model produced nothing usable,
			// so the item still has no text at all. Without this the chunk is
			// dropped downstream with no trace, which is what the two other
			// empty-text warnings above exist to prevent.
			parsed.Warnings = append(parsed.Warnings,
				"image has no searchable text: the vision model returned no description, so the Tokenizer will discard this item")
		}
	}
	return parsed, true, nil
}

func decodeDispatchImage(data []byte, decodeRaster bool) (image.Image, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("parser: decode image: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 {
		return nil, fmt.Errorf("parser: image has invalid dimensions %dx%d", config.Width, config.Height)
	}
	// Length/width are unbounded (mirrors Python's picture.py); the decoded
	// raster byte ceiling is opt-in via RAGFLOW_IMAGE_RASTER_MAX_BYTES (0 =
	// unlimited).
	if err := parser.CheckImageRasterLimit(config.Width, config.Height); err != nil {
		return nil, fmt.Errorf("parser: %w", err)
	}
	// VLM consumes the original bytes; only local OCR needs a decoded raster.
	if !decodeRaster {
		return nil, nil
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("parser: decode image: %w", err)
	}
	return img, nil
}

func extractImageText(ctx context.Context, img image.Image) (string, error) {
	analyzer, err := parser.GetDocAnalyzer()
	if err != nil {
		return "", err
	}
	if analyzer == nil || !analyzer.Health() {
		return "", fmt.Errorf("local OCR analyzer is unavailable")
	}
	boxes := deepdocpdf.OCRImage(ctx, img, analyzer, 1.0)
	sort.SliceStable(boxes, func(i, j int) bool {
		if boxes[i].Top == boxes[j].Top {
			return boxes[i].X0 < boxes[j].X0
		}
		return boxes[i].Top < boxes[j].Top
	})
	texts := make([]string, 0, len(boxes))
	for _, box := range boxes {
		if text := strings.TrimSpace(box.Text); text != "" {
			texts = append(texts, text)
		}
	}
	return strings.Join(texts, "\n"), nil
}

func describeImage(
	ctx context.Context,
	db *gorm.DB,
	dataURI string,
	tenantID string,
	setup schema.ParserSetup,
	inputs map[string]any,
	vision visionSettings,
) (string, []string) {
	// --- Optional VLM description ---
	// Captions follow the knowledge base language, which also drives
	// tokenization, so indexed text and analysis can never disagree. The family
	// setup's lang is not consulted here: it is an OCR engine input (see
	// pdf_vision_dispatch.go) and its old implicit default was the subject of
	// issue #20727.
	lang := resolveVisionLanguage(inputs)
	if tenantID == "" {
		return "", []string{"image VLM enhancement skipped: tenant ID is missing"}
	}

	// Use the selected description model or the tenant default.
	modelRef := vision.modelID
	var driver modelModule.ModelDriver
	var modelName string
	var apiConfig *modelModule.APIConfig
	var err error
	if modelRef != "" {
		driver, modelName, apiConfig, _, err = resolveModelConfig(ctx, db, tenantID, entity.ModelTypeImage2Text, modelRef)
		if err != nil {
			common.Warn("media dispatch image: per-call VLM resolve failed, falling back to tenant default",
				zap.String("modelRef", modelRef), zap.String("tenant", tenantID), zap.Error(err))
			driver, modelName, apiConfig, _, err = resolveTenantModelByType(ctx, db, tenantID, entity.ModelTypeImage2Text)
		}
	} else {
		driver, modelName, apiConfig, _, err = resolveTenantModelByType(ctx, db, tenantID, entity.ModelTypeImage2Text)
	}
	if err == nil && driver == nil {
		err = fmt.Errorf("no usable vision model")
	}
	if err != nil {
		return "", []string{fmt.Sprintf("image VLM enhancement skipped: model unavailable: %v", err)}
	}

	prompt := defaultImageVisionPrompt(lang)
	// The global enhancement prompt wins; the image family's legacy system_prompt
	// (the key the Python parser's image branch used) stays readable for canvases
	// saved before the move. Do NOT read setup["prompt"] here — that key is for
	// the video family, not image.
	if v := firstNonEmpty(vision.systemPrompt, getStringOr(setup, "system_prompt", "")); v != "" {
		prompt = v
	}
	messages := []modelModule.Message{{
		Role: "user",
		Content: []interface{}{
			map[string]any{"type": "text", "text": prompt},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURI}},
		},
	}}
	visionFlag := true
	chatModel := modelModule.NewChatModel(driver, &modelName, apiConfig)
	resp, err := chatModel.ChatWithMessages(ctx, messages, &modelModule.ChatConfig{Vision: &visionFlag}, nil)
	if err != nil {
		return "", []string{fmt.Sprintf("image VLM enhancement failed: %v", err)}
	}
	vlmText := ""
	if resp != nil && resp.Answer != nil {
		vlmText = strings.TrimSpace(*resp.Answer)
	}

	return vlmText, nil
}

// Audio dispatch: SPEECH2TEXT transcription ---
// Mirrors Python's rag/app/audio.py:chunk():
//   - Writes the audio binary to a temp file (extension-preserving)
//   - Calls the tenant's SPEECH2TEXT model via TranscribeAudio()
//   - Returns the transcription as text

func maybeDispatchAudio(
	ctx context.Context,
	db *gorm.DB,
	fileType utility.FileType,
	filename string,
	binary []byte,
	inputs map[string]any,
	setups map[string]schema.ParserSetup,
) (parser.ParseResult, bool, error) {
	if fileType != utility.FileTypeAURAL {
		return parser.ParseResult{}, false, nil
	}
	setup, ok := setups["audio"]
	if !ok {
		return parser.ParseResult{}, false, nil
	}
	tenantID := getStringOr(inputs, "tenant_id", "")
	if tenantID == "" {
		return parser.ParseResult{}, true,
			fmt.Errorf("parser: audio requires tenant_id")
	}

	modelRef := configuredAudioModelID(setup)
	var driver modelModule.ModelDriver
	var modelName string
	var apiConfig *modelModule.APIConfig
	var err error
	if modelRef != "" {
		driver, modelName, apiConfig, _, err = resolveModelConfig(ctx, db, tenantID, entity.ModelTypeSpeech2Text, modelRef)
		if err != nil {
			common.Warn("media dispatch audio: per-call VLM resolve failed, falling back to tenant default",
				zap.String("modelRef", modelRef), zap.String("tenant", tenantID), zap.Error(err))
			driver, modelName, apiConfig, _, err = resolveTenantModelByType(ctx, db, tenantID, entity.ModelTypeSpeech2Text)
		}
	} else {
		driver, modelName, apiConfig, _, err = resolveTenantModelByType(ctx, db, tenantID, entity.ModelTypeSpeech2Text)
	}
	if err != nil {
		return parser.ParseResult{}, true,
			fmt.Errorf("parser: audio speech2text model: %w", err)
	}

	asrModel := modelModule.NewASRModel(driver, &modelName, apiConfig)

	// Dual-track ("一问一答") mode. A stereo WAV exported by a contact-centre
	// recorder carries one speaker per channel, which can be transcribed and
	// re-interleaved by time into labelled turns. The switch is off unless the
	// setup turns it on, and every other shape (mono, compressed container,
	// unsupported bit depth) falls through to the whole-file transcription
	// below, so enabling it never loses a file.
	if settings := audioDialogueSetup(setup); settings.enabled {
		if result, handled, err := dispatchAudioDialogue(ctx, binary, asrModel, settings); handled {
			return result, true, err
		}
	}

	tmpFile, err := writeTempAudioFile(filename, binary)
	if err != nil {
		return parser.ParseResult{}, true,
			fmt.Errorf("parser: audio temp file: %w", err)
	}
	defer os.Remove(tmpFile)

	resp, err := asrModel.Transcribe(ctx, &tmpFile, nil, nil)
	if err != nil {
		return parser.ParseResult{}, true,
			fmt.Errorf("Parser: audio transcription: %w", err)
	}

	transcription := ""
	if resp != nil {
		transcription = resp.Text
	}

	return parser.ParseResult{
		OutputFormat: "json",
		JSON:         []parser.DocItem{parser.NewTextJSONItem(transcription)},
	}, true, nil
}

// audioDialogueSettings is the dual-track configuration of the audio family
// setup. LeftRole/RightRole are the speaker labels the indexed turns carry.
type audioDialogueSettings struct {
	enabled   bool
	leftRole  string
	rightRole string
}

// audioDialogueSetup reads the dual-track settings off a Parser setup. The
// switch is only honoured when it is explicitly true, so a knowledge base
// saved before the option existed keeps the whole-file transcription.
func audioDialogueSetup(setup schema.ParserSetup) audioDialogueSettings {
	settings := audioDialogueSettings{
		leftRole:  audioSpeakerRole(getStringOr(setup, "left_speaker", ""), "坐席"),
		rightRole: audioSpeakerRole(getStringOr(setup, "right_speaker", ""), "客户"),
	}
	// Configs reach the runtime as JSON, so the flag is normally a bool; accept
	// the string spellings too because a hand-written API payload can carry
	// either.
	switch raw := setup["dialogue_split"].(type) {
	case bool:
		settings.enabled = raw
	case string:
		switch strings.ToLower(strings.TrimSpace(raw)) {
		case "true", "1", "yes", "on":
			settings.enabled = true
		}
	}
	return settings
}

// audioSpeakerRole falls back to the default label when the operator left the
// field empty: a turn without a speaker reads as plain text, which is exactly
// what the switch is meant to avoid.
func audioSpeakerRole(configured, fallback string) string {
	if role := strings.TrimSpace(configured); role != "" {
		return role
	}
	return fallback
}

// dispatchAudioDialogue transcribes a stereo recording channel by channel and
// re-interleaves the two transcripts into labelled turns. The second return
// value reports whether this function handled the file: false means the audio
// is not a splittable dual-track WAV and the caller should fall back to the
// whole-file transcription.
func dispatchAudioDialogue(
	ctx context.Context,
	binary []byte,
	asrModel *modelModule.ASRModel,
	settings audioDialogueSettings,
) (parser.ParseResult, bool, error) {
	leftWAV, rightWAV, err := parser.SplitStereoWAV(binary)
	if err != nil {
		// Mono, compressed container, or a bit depth the splitter does not
		// handle: the whole-file transcription is the right answer for it.
		return parser.ParseResult{}, false, nil
	}
	leftFile, err := writeTempAudio(".wav", leftWAV)
	if err != nil {
		return parser.ParseResult{}, true, fmt.Errorf("parser: audio dialogue temp file: %w", err)
	}
	defer os.Remove(leftFile)
	rightFile, err := writeTempAudio(".wav", rightWAV)
	if err != nil {
		return parser.ParseResult{}, true, fmt.Errorf("parser: audio dialogue temp file: %w", err)
	}
	defer os.Remove(rightFile)

	// The two channels are independent requests against the same provider, so
	// they run concurrently: the wall time is one transcription, not two.
	var (
		wg        sync.WaitGroup
		leftResp  *modelModule.ASRResponse
		rightResp *modelModule.ASRResponse
		leftErr   error
		rightErr  error
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		leftResp, leftErr = asrModel.Transcribe(ctx, &leftFile, nil, nil)
	}()
	go func() {
		defer wg.Done()
		rightResp, rightErr = asrModel.Transcribe(ctx, &rightFile, nil, nil)
	}()
	wg.Wait()

	// A channel that recognised nothing is a muted track, not a failure: the
	// recording still comes back labelled by its only speaker. Anything else
	// is a real error and fails the document rather than silently dropping
	// half of the conversation.
	for _, channel := range []struct {
		name string
		err  error
	}{{"left", leftErr}, {"right", rightErr}} {
		if channel.err != nil && !isASRNoSpeechError(channel.err) {
			return parser.ParseResult{}, true,
				fmt.Errorf("Parser: audio transcription (%s channel): %w", channel.name, channel.err)
		}
	}

	leftSentences := asrTimedSentences(leftResp)
	rightSentences := asrTimedSentences(rightResp)
	var warnings []string
	// A driver that answers with a plain transcript and no per-sentence
	// timings still gets the speaker labels; the two turns simply are not
	// interleaved, so say so instead of pretending otherwise.
	if len(leftSentences) == 0 && leftResp != nil && strings.TrimSpace(leftResp.Text) != "" {
		leftSentences = []parser.TimedSentence{{Text: leftResp.Text}}
		warnings = append(warnings, "audio dialogue split: the ASR model returned no sentence timings, so the left channel is one unsegmented turn")
	}
	if len(rightSentences) == 0 && rightResp != nil && strings.TrimSpace(rightResp.Text) != "" {
		rightSentences = []parser.TimedSentence{{Text: rightResp.Text}}
		warnings = append(warnings, "audio dialogue split: the ASR model returned no sentence timings, so the right channel is one unsegmented turn")
	}

	turns := parser.MergeDialogueTurns(leftSentences, rightSentences, settings.leftRole, settings.rightRole, 0)
	lines := parser.DialogueLines(turns)
	if len(lines) == 0 {
		// Both channels were silent. One empty item mirrors the whole-file
		// path's behaviour for a silent recording.
		warnings = append(warnings, "audio dialogue split: neither channel contained recognisable speech")
		return parser.ParseResult{
			OutputFormat: "json",
			JSON:         []parser.DocItem{parser.NewTextJSONItem("")},
			Warnings:     warnings,
		}, true, nil
	}
	items := make([]parser.DocItem, 0, len(lines))
	for _, line := range lines {
		items = append(items, parser.NewTextJSONItem(line))
	}
	return parser.ParseResult{OutputFormat: "json", JSON: items, Warnings: warnings}, true, nil
}

// asrTimedSentences projects a driver response onto the parser's timed
// sentences, dropping the empty ones. A nil response (a channel that failed
// with "no speech") contributes nothing.
func asrTimedSentences(resp *modelModule.ASRResponse) []parser.TimedSentence {
	if resp == nil {
		return nil
	}
	out := make([]parser.TimedSentence, 0, len(resp.Sentences))
	for _, sentence := range resp.Sentences {
		if strings.TrimSpace(sentence.Text) == "" {
			continue
		}
		out = append(out, parser.TimedSentence{
			BeginMS: sentence.BeginMS,
			EndMS:   sentence.EndMS,
			Text:    sentence.Text,
		})
	}
	return out
}

// isASRNoSpeechError reports whether an ASR error means "this audio carried no
// recognisable speech". The sentinel is the contract (models.ErrASRNoSpeech);
// the substring check covers drivers that surface the provider's own marker
// without wrapping it.
func isASRNoSpeechError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, modelModule.ErrASRNoSpeech) {
		return true
	}
	message := strings.ToUpper(err.Error())
	return strings.Contains(message, "ASR_RESPONSE_HAVE_NO_WORDS") ||
		strings.Contains(message, "NO SPEECH")
}

// writeTempAudioFile writes binary to a temp file preserving the
// original extension so the ASR provider can detect the format.
func writeTempAudioFile(filename string, binary []byte) (string, error) {
	return writeTempAudio(filepath.Ext(filename), binary)
}

// writeTempAudio writes data to a temp file with the given extension. The
// extension matters: DashScope rejects an audio whose parameters.format does
// not match the container it is handed.
func writeTempAudio(ext string, data []byte) (string, error) {
	tmp, err := os.CreateTemp("", "ragflow_audio_*"+ext)
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	if _, err := tmp.Write(data); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}

// videoMIME maps common video filename extensions to MIME types
// for constructing base64 data URIs. Retained as a reference for the
// future real video-parsing implementation (provider-specific frame
// extraction / inline_data / file://); not currently used because
// maybeDispatchVideo returns an explicit unsupported error.
func videoMIME(filename string) string {
	dot := strings.LastIndex(filename, ".")
	if dot == -1 {
		return "video/mp4"
	}
	switch strings.ToLower(filename[dot+1:]) {
	case "mp4":
		return "video/mp4"
	case "avi":
		return "video/x-msvideo"
	case "mkv":
		return "video/x-matroska"
	case "mov":
		return "video/quicktime"
	case "wmv":
		return "video/x-ms-wmv"
	case "flv":
		return "video/x-flv"
	case "webm":
		return "video/webm"
	case "mpeg", "mpg":
		return "video/mpeg"
	case "3gp":
		return "video/3gpp"
	default:
		return "video/mp4"
	}
}
