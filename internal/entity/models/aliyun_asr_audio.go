//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package models

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	// aliyunASRMaxDurationSeconds is DashScope's per-request cap on the
	// multimodal-generation ASR endpoint. Longer audio is rejected with
	// AUDIO_DURATION_TOO_LONG ("audio duration (311760.0ms) over service
	// process (300s)"), which is why long recordings are split client side.
	aliyunASRMaxDurationSeconds = 300

	// aliyunASRMaxPayloadChars bounds one request's audio payload. DashScope
	// parses the request body with Jackson's default 28,000,000-character
	// string limit and answers 400 InvalidParameter
	// ("String value length (28049408) exceeds the maximum allowed
	// (28000000, from StreamReadConstraints.getMaxStringLength())") for
	// anything longer. The budget sits below that ceiling because the audio
	// travels as a base64 data URL inside a JSON string.
	aliyunASRMaxPayloadChars = 20_000_000

	// aliyunASRMaxPayloadBytes is the raw audio size whose base64 form still
	// fits aliyunASRMaxPayloadChars (base64 expands by 4/3).
	aliyunASRMaxPayloadBytes = aliyunASRMaxPayloadChars * 3 / 4

	// aliyunASRSegmentSeconds is the preferred segment length. It is an upper
	// bound only: a high-bitrate recording reaches aliyunASRMaxPayloadBytes
	// sooner (44.1kHz stereo 16-bit PCM is 176,400 B/s, so 120s would already
	// be 21MB and blow the character ceiling), so the byte budget shortens it.
	aliyunASRSegmentSeconds = 120
)

// aliyunASRSegment is one request payload plus the point on the recording's
// timeline it starts at, so per-sentence timings can be shifted back.
type aliyunASRSegment struct {
	Audio   []byte
	StartMS int64
}

// aliyunAudioFormat maps a filename to the audio format DashScope expects in
// parameters.format. The provider cannot sniff the container out of the data
// URL, so omitting this fails with UNSUPPORTED_FORMAT "format is empty".
func aliyunAudioFormat(filename string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
	switch ext {
	case "wave":
		return "wav"
	case "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "amr", "wma":
		return ext
	}
	return ""
}

// aliyunASRSegments returns the payloads to transcribe. A PCM WAV that either
// runs past the provider's duration cap or encodes to a request body above the
// provider's string ceiling is split into valid WAV segments; anything else is
// sent as a single payload, because cutting a compressed container without
// decoding it would produce an unplayable fragment.
func aliyunASRSegments(audio []byte, format string) []aliyunASRSegment {
	if format != "wav" {
		return []aliyunASRSegment{{Audio: audio}}
	}
	wav, ok := parseAliyunWAV(audio)
	if !ok {
		// Unparseable: send as-is and let the provider decide.
		return []aliyunASRSegment{{Audio: audio}}
	}
	if wav.durationSeconds() <= aliyunASRMaxDurationSeconds && wav.fileSize() <= aliyunASRMaxPayloadBytes {
		return []aliyunASRSegment{{Audio: audio}}
	}
	return wav.split(aliyunASRSegmentSeconds, aliyunASRMaxPayloadBytes)
}

// aliyunASRPayloadError reports audio that cannot be sent at all: the payload
// is not a splittable WAV and one request would still exceed the provider's
// string ceiling. Returning this instead of the provider's 400 keeps the cause
// (and the fix) visible to the operator.
func aliyunASRPayloadError(audio []byte) error {
	encoded := base64.StdEncoding.EncodedLen(len(audio))
	if encoded <= aliyunASRMaxPayloadChars {
		return nil
	}
	return fmt.Errorf(
		"audio payload is %d bytes (%.1f MiB, ~%d base64 characters), above the speech-to-text provider's single-request limit of %d characters; convert it to a 16kHz mono WAV so it can be segmented, or transcribe a shorter clip",
		len(audio), float64(len(audio))/(1<<20), encoded, aliyunASRMaxPayloadChars)
}

// aliyunWAV is the handful of fields needed to cut a WAV into playable pieces.
// The fmt chunk is copied verbatim so sample rate / channel layout / bit depth
// (including the extensible form) survive the split.
type aliyunWAV struct {
	fmtChunk   []byte
	data       []byte
	byteRate   int
	blockAlign int
}

func parseAliyunWAV(data []byte) (*aliyunWAV, bool) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return nil, false
	}
	wav := &aliyunWAV{}
	offset := 12
	for offset+8 <= len(data) {
		id := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		body := offset + 8
		if size < 0 || body+size > len(data) {
			// Truncated final chunk: keep the bytes that are actually there.
			size = len(data) - body
		}
		switch id {
		case "fmt ":
			wav.fmtChunk = data[body : body+size]
		case "data":
			wav.data = data[body : body+size]
		}
		offset = body + size + size%2
		if wav.fmtChunk != nil && wav.data != nil {
			break
		}
	}
	// byteRate lives at fmt+8, blockAlign at fmt+12.
	if len(wav.fmtChunk) < 14 || len(wav.data) == 0 {
		return nil, false
	}
	wav.byteRate = int(binary.LittleEndian.Uint32(wav.fmtChunk[8:12]))
	wav.blockAlign = int(binary.LittleEndian.Uint16(wav.fmtChunk[12:14]))
	if wav.byteRate <= 0 {
		return nil, false
	}
	return wav, true
}

func (w *aliyunWAV) durationSeconds() float64 {
	return float64(len(w.data)) / float64(w.byteRate)
}

// headerSize is the RIFF header encode() rebuilds around a segment's frames.
func (w *aliyunWAV) headerSize() int {
	return 12 + 8 + len(w.fmtChunk) + 8
}

// fileSize is the size of the canonical WAV encode() would produce for the
// whole data chunk, i.e. what base64 sees once the payload is sent.
func (w *aliyunWAV) fileSize() int {
	return w.headerSize() + len(w.data)
}

// split cuts the data chunk into pieces no longer than segmentSeconds and no
// larger than maxBytes once encoded, aligned to whole sample frames so no
// sample is truncated. A fixed segment length is not enough on its own: the
// provider limits the request body, not the clock, so a 44.1kHz stereo
// recording hits that limit long before segmentSeconds elapses.
func (w *aliyunWAV) split(segmentSeconds, maxBytes int) []aliyunASRSegment {
	step := w.byteRate * segmentSeconds
	if budget := maxBytes - w.headerSize(); budget > 0 && step > budget {
		step = budget
	}
	if w.blockAlign > 1 {
		step -= step % w.blockAlign
	}
	if step <= 0 {
		return []aliyunASRSegment{{Audio: w.encode(w.data)}}
	}
	segments := make([]aliyunASRSegment, 0, len(w.data)/step+1)
	for start := 0; start < len(w.data); start += step {
		end := start + step
		if end > len(w.data) {
			end = len(w.data)
		}
		segments = append(segments, aliyunASRSegment{
			Audio:   w.encode(w.data[start:end]),
			StartMS: int64(start) * 1000 / int64(w.byteRate),
		})
	}
	return segments
}

// encode rebuilds a canonical RIFF/WAVE file around the given frames.
func (w *aliyunWAV) encode(frames []byte) []byte {
	var buf bytes.Buffer
	buf.Grow(12 + 8 + len(w.fmtChunk) + 8 + len(frames))
	buf.WriteString("RIFF")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(4+8+len(w.fmtChunk)+8+len(frames)))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(w.fmtChunk)))
	buf.Write(w.fmtChunk)
	buf.WriteString("data")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(frames)))
	buf.Write(frames)
	return buf.Bytes()
}
