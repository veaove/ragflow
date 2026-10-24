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

package parser

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// riffChunk is one chunk of a RIFF file under test.
type riffChunk struct {
	id   string
	body []byte
}

// buildWAV assembles a RIFF/WAVE file from fmt and data chunks, optionally
// prefixed with junkPrefix bytes of private header the way contact-centre
// exporters do.
func buildWAV(channels, sampleRate, bits int, frames []byte, junkPrefix int) []byte {
	fmtBody := make([]byte, 16)
	binary.LittleEndian.PutUint16(fmtBody[0:2], 1) // PCM
	binary.LittleEndian.PutUint16(fmtBody[2:4], uint16(channels))
	binary.LittleEndian.PutUint32(fmtBody[4:8], uint32(sampleRate))
	binary.LittleEndian.PutUint32(fmtBody[8:12], uint32(sampleRate*channels*bits/8))
	binary.LittleEndian.PutUint16(fmtBody[12:14], uint16(channels*bits/8))
	binary.LittleEndian.PutUint16(fmtBody[14:16], uint16(bits))

	var buf bytes.Buffer
	if junkPrefix > 0 {
		buf.Write(bytes.Repeat([]byte{0x7f}, junkPrefix))
	}
	buf.WriteString("RIFF")
	body := riffBody([]riffChunk{{"fmt ", fmtBody}, {"data", frames}})
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(body)))
	buf.WriteString("WAVE")
	buf.Write(body)
	return buf.Bytes()
}

func riffBody(chunks []riffChunk) []byte {
	var buf bytes.Buffer
	for _, chunk := range chunks {
		buf.WriteString(chunk.id)
		_ = binary.Write(&buf, binary.LittleEndian, uint32(len(chunk.body)))
		buf.Write(chunk.body)
		if len(chunk.body)%2 == 1 {
			buf.WriteByte(0)
		}
	}
	return buf.Bytes()
}

// stereoFrames interleaves left/right 16-bit samples, one per channel per
// frame.
func stereoFrames(left, right []int16) []byte {
	frames := make([]byte, 0, 4*len(left))
	var tmp [2]byte
	for i := range left {
		binary.LittleEndian.PutUint16(tmp[:], uint16(left[i]))
		frames = append(frames, tmp[0], tmp[1])
		binary.LittleEndian.PutUint16(tmp[:], uint16(right[i]))
		frames = append(frames, tmp[0], tmp[1])
	}
	return frames
}

// monoSamples reads a mono WAV's samples back as int16.
func monoSamples(t *testing.T, wav []byte) []int16 {
	t.Helper()
	info, ok := ProbeWAV(wav)
	if !ok {
		t.Fatalf("not a probeable WAV")
	}
	if len(info.PCM)%2 != 0 {
		t.Fatalf("PCM length %d is not a whole number of samples", len(info.PCM))
	}
	samples := make([]int16, 0, len(info.PCM)/2)
	for i := 0; i+2 <= len(info.PCM); i += 2 {
		samples = append(samples, int16(binary.LittleEndian.Uint16(info.PCM[i:i+2])))
	}
	return samples
}

func TestProbeWAV(t *testing.T) {
	frames := stereoFrames([]int16{1, 2, 3}, []int16{-1, -2, -3})
	data := buildWAV(2, 8000, 16, frames, 32)

	info, ok := ProbeWAV(data)
	if !ok {
		t.Fatalf("ProbeWAV() ok = false, want true")
	}
	if info.Channels != 2 {
		t.Errorf("Channels = %d, want 2", info.Channels)
	}
	if info.SampleRate != 8000 {
		t.Errorf("SampleRate = %d, want 8000", info.SampleRate)
	}
	if info.Bits != 16 {
		t.Errorf("Bits = %d, want 16", info.Bits)
	}
	if info.JunkPrefix != 32 {
		t.Errorf("JunkPrefix = %d, want 32", info.JunkPrefix)
	}
	if !bytes.Equal(info.PCM, frames) {
		t.Errorf("PCM = %d bytes, want %d bytes identical to the interleaved frames", len(info.PCM), len(frames))
	}
}

func TestProbeWAVRejectsUnsupportedShapes(t *testing.T) {
	cases := []struct {
		name   string
		chans  int
		bits   int
		frames []byte
	}{
		{name: "8-bit", chans: 1, bits: 8, frames: []byte{0, 1, 2}},
		{name: "24-bit", chans: 2, bits: 24, frames: []byte{0, 1, 2, 3}},
		{name: "no data chunk", chans: 1, bits: 16, frames: nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := ProbeWAV(buildWAV(tc.chans, 8000, tc.bits, tc.frames, 0)); ok {
				t.Fatalf("ProbeWAV() ok = true, want false for %s", tc.name)
			}
		})
	}
}

func TestProbeWAVRejectsNonWAV(t *testing.T) {
	if _, ok := ProbeWAV([]byte("ID3\x04\x00\x00\x00\x00\x00\x00not a wave file at all")); ok {
		t.Fatalf("ProbeWAV() ok = true for a non-WAV payload, want false")
	}
	if _, ok := ProbeWAV([]byte("RI")); ok {
		t.Fatalf("ProbeWAV() ok = true for a truncated payload, want false")
	}
}

func TestSplitStereoWAV(t *testing.T) {
	left := []int16{100, 200, 300, 400}
	right := []int16{-100, -200, -300, -400}
	data := buildWAV(2, 8000, 16, stereoFrames(left, right), 32)

	leftWAV, rightWAV, err := SplitStereoWAV(data)
	if err != nil {
		t.Fatalf("SplitStereoWAV() error = %v", err)
	}
	for name, wav := range map[string][]byte{"left": leftWAV, "right": rightWAV} {
		info, ok := ProbeWAV(wav)
		if !ok {
			t.Fatalf("%s half is not a probeable WAV", name)
		}
		if info.Channels != 1 {
			t.Errorf("%s half Channels = %d, want 1", name, info.Channels)
		}
		if info.SampleRate != 8000 {
			t.Errorf("%s half SampleRate = %d, want 8000", name, info.SampleRate)
		}
		if info.JunkPrefix != 0 {
			t.Errorf("%s half JunkPrefix = %d, want 0 (canonical output)", name, info.JunkPrefix)
		}
	}

	for name, want := range map[string][]int16{"left": left, "right": right} {
		var got []int16
		if name == "left" {
			got = monoSamples(t, leftWAV)
		} else {
			got = monoSamples(t, rightWAV)
		}
		if len(got) != len(want) {
			t.Fatalf("%s half carries %d samples, want %d", name, len(got), len(want))
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("%s sample %d = %d, want %d", name, i, got[i], want[i])
			}
		}
	}
}

func TestSplitStereoWAVRejectsMono(t *testing.T) {
	frames := make([]byte, 4)
	binary.LittleEndian.PutUint16(frames[0:2], 100)
	binary.LittleEndian.PutUint16(frames[2:4], 200)
	data := buildWAV(1, 8000, 16, frames, 0)

	if _, _, err := SplitStereoWAV(data); err == nil {
		t.Fatalf("SplitStereoWAV() error = nil for a mono file, want an error")
	}
}

func TestMergeDialogueTurnsInterleavesAndGroups(t *testing.T) {
	left := []TimedSentence{
		{BeginMS: 0, EndMS: 1000, Text: "您好"},
		{BeginMS: 2000, EndMS: 3000, Text: "请问有什么可以帮您"},
		{BeginMS: 20000, EndMS: 21000, Text: "已经为您记录了"},
	}
	right := []TimedSentence{
		{BeginMS: 4000, EndMS: 5000, Text: "我的车无法启动"},
		{BeginMS: 6000, EndMS: 7000, Text: "仪表盘显示故障灯"},
	}

	turns := MergeDialogueTurns(left, right, "坐席", "客户", 0)

	want := []string{
		"坐席：您好请问有什么可以帮您",
		"客户：我的车无法启动仪表盘显示故障灯",
		"坐席：已经为您记录了",
	}
	got := DialogueLines(turns)
	if len(got) != len(want) {
		t.Fatalf("DialogueLines() = %d lines, want %d: %q", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d = %q, want %q", i, got[i], want[i])
		}
	}
	// The first turn spans both of the agent's opening sentences.
	if turns[0].BeginMS != 0 || turns[0].EndMS != 3000 {
		t.Errorf("first turn window = [%d, %d], want [0, 3000]", turns[0].BeginMS, turns[0].EndMS)
	}
}

func TestMergeDialogueTurnsGapStartsNewTurn(t *testing.T) {
	// A pause longer than the gap separates two turns of the SAME speaker even
	// when the other channel is silent.
	sentences := []TimedSentence{
		{BeginMS: 0, EndMS: 1000, Text: "第一句"},
		{BeginMS: 5000, EndMS: 6000, Text: "第二句"},
	}

	turns := MergeDialogueTurns(sentences, nil, "坐席", "客户", 1200)
	lines := DialogueLines(turns)
	if len(lines) != 2 {
		t.Fatalf("DialogueLines() = %d lines, want 2: %q", len(lines), lines)
	}
	if lines[0] != "坐席：第一句" || lines[1] != "坐席：第二句" {
		t.Errorf("lines = %q, want two separate 坐席 turns", lines)
	}
}

func TestMergeDialogueTurnsOneSidedRecording(t *testing.T) {
	// A muted track (or the provider's "no speech" answer) contributes nothing,
	// so the recording still comes back labelled by its only speaker.
	right := []TimedSentence{
		{BeginMS: 1000, EndMS: 2000, Text: "只有客户在说"},
		{BeginMS: 9000, EndMS: 10000, Text: "还有一句"},
	}
	lines := DialogueLines(MergeDialogueTurns(nil, right, "坐席", "客户", 0))
	if len(lines) != 2 {
		t.Fatalf("DialogueLines() = %d lines, want 2: %q", len(lines), lines)
	}
	if lines[0] != "客户：只有客户在说" || lines[1] != "客户：还有一句" {
		t.Errorf("lines = %q, want 客户-labelled turns", lines)
	}
}

func TestMergeDialogueTurnsEmptyInput(t *testing.T) {
	if lines := DialogueLines(MergeDialogueTurns(nil, nil, "坐席", "客户", 0)); len(lines) != 0 {
		t.Fatalf("DialogueLines() = %q, want none", lines)
	}
	// Blank sentences are dropped rather than rendered as "坐席：".
	lines := DialogueLines(MergeDialogueTurns(
		[]TimedSentence{{BeginMS: 0, EndMS: 100, Text: "   "}},
		[]TimedSentence{{BeginMS: 0, EndMS: 100, Text: "\n"}},
		"坐席", "客户", 0))
	if len(lines) != 0 {
		t.Fatalf("DialogueLines() = %q for blank sentences, want none", lines)
	}
}

func TestDialogueTurnLineWithoutSpeaker(t *testing.T) {
	turn := DialogueTurn{Speaker: "  ", Text: "  没有说话人的文本  "}
	if got := turn.Line(); got != "没有说话人的文本" {
		t.Errorf("Line() = %q, want the bare text", got)
	}
}

func TestMergeDialogueTurnsOrdersUnsortedSentences(t *testing.T) {
	// Providers are not guaranteed to answer in time order; a channel's
	// sentences are sorted before the turns are grouped.
	left := []TimedSentence{
		{BeginMS: 8000, EndMS: 9000, Text: "后一句"},
		{BeginMS: 0, EndMS: 1000, Text: "前一句"},
	}
	lines := DialogueLines(MergeDialogueTurns(left, nil, "坐席", "客户", 0))
	if len(lines) != 2 || lines[0] != "坐席：前一句" || lines[1] != "坐席：后一句" {
		t.Fatalf("lines = %q, want the sentences in time order", lines)
	}
}

func TestSplitStereoWAVTruncatedTail(t *testing.T) {
	// A truncated final frame is dropped rather than producing a half frame.
	frames := stereoFrames([]int16{1, 2, 3}, []int16{-1, -2, -3})
	data := buildWAV(2, 8000, 16, frames, 0)
	data = data[:len(data)-2] // cut one stereo frame's right sample

	if _, _, err := SplitStereoWAV(data); err != nil {
		t.Fatalf("SplitStereoWAV() error = %v, want the whole frames to survive", err)
	}
}

func TestEncodeWAVRoundTrip(t *testing.T) {
	negative := int16(-4321)
	frames := make([]byte, 8)
	binary.LittleEndian.PutUint16(frames[0:2], 1234)
	binary.LittleEndian.PutUint16(frames[6:8], uint16(negative))
	wav := encodeWAV(16000, frames)

	info, ok := ProbeWAV(wav)
	if !ok {
		t.Fatalf("ProbeWAV(encodeWAV) ok = false, want true")
	}
	if info.SampleRate != 16000 || info.Channels != 1 || info.Bits != 16 {
		t.Fatalf("header = %+v, want 16000Hz mono 16-bit", info)
	}
	if !bytes.Equal(info.PCM, frames) {
		t.Errorf("PCM round-trip = %v, want %v", info.PCM, frames)
	}
	if got := monoSamples(t, wav); got[0] != 1234 || got[3] != negative {
		t.Errorf("samples = %v, want [1234 0 0 %d]", got, negative)
	}
}
