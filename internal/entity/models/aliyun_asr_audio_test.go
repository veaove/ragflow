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
	"encoding/binary"
	"testing"
)

// buildTestWAV assembles a canonical 16-bit PCM RIFF/WAVE file. sampleRate and
// channels are written verbatim, so a test can pick a tiny byteRate and reach a
// multi-minute "duration" with a few hundred bytes of frames.
func buildTestWAV(sampleRate, channels uint16, frames int) []byte {
	bits := uint16(16)
	blockAlign := channels * bits / 8
	byteRate := sampleRate * blockAlign
	dataLen := frames * int(blockAlign)

	out := make([]byte, 0, 44+dataLen)
	out = append(out, "RIFF"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(36+dataLen))
	out = append(out, "WAVE"...)
	out = append(out, "fmt "...)
	out = binary.LittleEndian.AppendUint32(out, 16)
	out = binary.LittleEndian.AppendUint16(out, 1) // PCM
	out = binary.LittleEndian.AppendUint16(out, channels)
	out = binary.LittleEndian.AppendUint32(out, uint32(sampleRate))
	out = binary.LittleEndian.AppendUint32(out, uint32(byteRate))
	out = binary.LittleEndian.AppendUint16(out, blockAlign)
	out = binary.LittleEndian.AppendUint16(out, bits)
	out = append(out, "data"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(dataLen))
	out = append(out, make([]byte, dataLen)...)
	return out
}

func TestAliyunAudioFormat(t *testing.T) {
	cases := map[string]string{
		"clip.mp3":          "mp3",
		"clip.WAV":          "wav",
		"legacy.wave":       "wav",
		"meeting.m4a":       "m4a",
		"voice.ogg":         "ogg",
		"unknown":           "",
		"weird.txt":         "",
		"/data/audio/fl.flac": "flac",
	}
	for filename, want := range cases {
		if got := aliyunAudioFormat(filename); got != want {
			t.Errorf("aliyunAudioFormat(%q) = %q, want %q", filename, got, want)
		}
	}
}

func TestAliyunASRSegmentsKeepsShortAndCompressedAudioWhole(t *testing.T) {
	short := buildTestWAV(16000, 1, 16000) // 1 second
	if segments := aliyunASRSegments(short, "wav"); len(segments) != 1 {
		t.Fatalf("short wav segments = %d, want 1", len(segments))
	}
	// A compressed container is never cut: slicing it would lose frame sync.
	mp3 := []byte("ID3....")
	segments := aliyunASRSegments(mp3, "mp3")
	if len(segments) != 1 || string(segments[0]) != string(mp3) {
		t.Fatalf("mp3 segments = %d, want the original payload once", len(segments))
	}
	// Unparseable audio is passed through untouched.
	if got := aliyunASRSegments([]byte("RIFF....WAVE"), "wav"); len(got) != 1 {
		t.Fatalf("unparseable wav segments = %d, want 1", len(got))
	}
}

func TestAliyunASRSegmentsSplitsLongWAV(t *testing.T) {
	// sampleRate 1 + mono 16-bit => blockAlign 2, so 600 frames is exactly
	// 600 seconds: twice the 300s provider cap, five 120s segments.
	wav := buildTestWAV(1, 1, 600)
	segments := aliyunASRSegments(wav, "wav")
	if len(segments) != 5 {
		t.Fatalf("segments = %d, want 5 (600s at 120s each)", len(segments))
	}

	totalFrames := 0
	for i, segment := range segments {
		parsed, ok := parseAliyunWAV(segment)
		if !ok {
			t.Fatalf("segment %d is not a parseable wav", i)
		}
		if d := parsed.durationSeconds(); d > aliyunASRMaxDurationSeconds {
			t.Errorf("segment %d duration = %.0fs, want <= %ds", i, d, aliyunASRMaxDurationSeconds)
		}
		if len(parsed.fmtChunk) != 16 {
			t.Errorf("segment %d fmt chunk = %d bytes, want 16", i, len(parsed.fmtChunk))
		}
		totalFrames += len(parsed.data) / parsed.blockAlign
	}
	if totalFrames != 600 {
		t.Errorf("frames across segments = %d, want 600 (no sample lost)", totalFrames)
	}
}
