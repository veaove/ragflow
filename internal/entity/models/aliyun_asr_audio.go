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
	"encoding/binary"
	"path/filepath"
	"strings"
)

const (
	// aliyunASRMaxDurationSeconds is DashScope's per-request cap on the
	// multimodal-generation ASR endpoint. Longer audio is rejected with
	// AUDIO_DURATION_TOO_LONG ("audio duration (311760.0ms) over service
	// process (300s)"), which is why long recordings are split client side.
	aliyunASRMaxDurationSeconds = 300

	// aliyunASRSegmentSeconds keeps every request well under the cap and small
	// enough to send as base64: a 120s 8kHz/16-bit WAV is ~1.9MB instead of the
	// ~7.5MB the whole recording would take.
	aliyunASRSegmentSeconds = 120
)

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

// aliyunASRSegments returns the payloads to transcribe. A PCM WAV longer than
// the provider cap is split into valid WAV segments; anything else is sent as a
// single payload, because cutting a compressed container without decoding it
// would produce an unplayable fragment.
func aliyunASRSegments(audio []byte, format string) [][]byte {
	if format != "wav" {
		return [][]byte{audio}
	}
	wav, ok := parseAliyunWAV(audio)
	if !ok || wav.durationSeconds() <= aliyunASRMaxDurationSeconds {
		// Unparseable or short enough: send as-is and let the provider decide.
		return [][]byte{audio}
	}
	return wav.split(aliyunASRSegmentSeconds)
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

// split cuts the data chunk into segmentSeconds pieces, aligned to whole sample
// frames so no sample is truncated.
func (w *aliyunWAV) split(segmentSeconds int) [][]byte {
	step := w.byteRate * segmentSeconds
	if w.blockAlign > 1 {
		step -= step % w.blockAlign
	}
	if step <= 0 {
		return [][]byte{w.encode(w.data)}
	}
	segments := make([][]byte, 0, len(w.data)/step+1)
	for start := 0; start < len(w.data); start += step {
		end := start + step
		if end > len(w.data) {
			end = len(w.data)
		}
		segments = append(segments, w.encode(w.data[start:end]))
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
