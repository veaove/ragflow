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
	"fmt"
	"sort"
	"strings"
)

// Two-party call recordings are exported by contact-centre systems in one of
// two shapes: a single mixed channel, or a "dual track" file where the agent
// sits on one channel and the customer on the other. The helpers here work on
// the dual-track shape: split the channels, transcribe each on its own, then
// interleave the two transcripts by time so the result reads as a dialogue
// ("坐席：…… / 客户：……") instead of one flat stream.
//
// Everything in this file is pure so it can be exercised without a model or a
// database; the ASR calls that produce the TimedSentences live in the
// ingestion component layer.

// TimedSentence is one recognised sentence, timed in milliseconds from the
// start of the audio handed to the ASR provider.
type TimedSentence struct {
	BeginMS int64
	EndMS   int64
	Text    string
}

// DialogueTurn is one speaker's continuous speech. A turn groups the
// consecutive sentences of the same speaker that no pause separates.
type DialogueTurn struct {
	Speaker string
	Text    string
	BeginMS int64
	EndMS   int64
}

// Line renders the turn the way it is indexed: "坐席：您好，请问有什么可以帮您？".
func (t DialogueTurn) Line() string {
	text := strings.TrimSpace(t.Text)
	if text == "" {
		return ""
	}
	speaker := strings.TrimSpace(t.Speaker)
	if speaker == "" {
		return text
	}
	return speaker + "：" + text
}

// DialogueLines renders every turn, dropping the empty ones.
func DialogueLines(turns []DialogueTurn) []string {
	lines := make([]string, 0, len(turns))
	for _, turn := range turns {
		if line := turn.Line(); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// DefaultDialogueGapMS is the silence that starts a new turn for the same
// speaker. Call-centre speech rarely pauses this long mid-sentence, while a
// speaker handover always does, so it also keeps the two speakers apart when
// their channels are re-interleaved.
const DefaultDialogueGapMS int64 = 1200

// WAVInfo is the header of a RIFF/WAVE file. PCM carries the raw interleaved
// frames; JunkPrefix records how many bytes precede the RIFF header, because
// contact-centre exporters like to prepend a private record header.
type WAVInfo struct {
	Channels   int
	SampleRate int
	Bits       int
	PCM        []byte
	JunkPrefix int
}

// ProbeWAV parses a RIFF/WAVE header. It tolerates a junk prefix (some
// exporters prepend a private record header before "RIFF") and a truncated
// final chunk, both of which are common in call-centre exports. Only 16-bit
// samples are supported; other depths return ok=false so the caller can fall
// back to the whole-file transcription.
func ProbeWAV(data []byte) (WAVInfo, bool) {
	info := WAVInfo{}
	if len(data) < 12 {
		return info, false
	}
	offset := bytes.Index(data, []byte("RIFF"))
	if offset < 0 || offset+12 > len(data) || string(data[offset+8:offset+12]) != "WAVE" {
		return info, false
	}
	info.JunkPrefix = offset
	offset += 12

	var fmtChunk []byte
	for offset+8 <= len(data) {
		id := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		body := offset + 8
		if size < 0 || body+size > len(data) {
			size = len(data) - body
		}
		if id == "fmt " {
			fmtChunk = data[body : body+size]
		} else if id == "data" {
			info.PCM = data[body : body+size]
		}
		if fmtChunk != nil && info.PCM != nil {
			break
		}
		offset = body + size + size%2
	}
	if len(fmtChunk) < 16 || len(info.PCM) == 0 {
		return info, false
	}
	// fmt: audioFormat(2) channels(2) sampleRate(4) byteRate(4) blockAlign(2) bits(2)
	info.Channels = int(binary.LittleEndian.Uint16(fmtChunk[2:4]))
	info.SampleRate = int(binary.LittleEndian.Uint32(fmtChunk[4:8]))
	info.Bits = int(binary.LittleEndian.Uint16(fmtChunk[14:16]))
	if info.Channels <= 0 || info.SampleRate <= 0 || info.Bits != 16 {
		return WAVInfo{}, false
	}
	return info, true
}

// SplitStereoWAV de-interleaves a two-channel WAV into two single-channel WAV
// files: index 0 is the left channel, index 1 the right. Sample rate, bit
// depth and the audio format are preserved, so both halves can be transcribed
// independently and still line up with the original timeline.
func SplitStereoWAV(data []byte) ([]byte, []byte, error) {
	info, ok := ProbeWAV(data)
	if !ok {
		return nil, nil, fmt.Errorf("audio: not a 16-bit RIFF/WAVE file")
	}
	if info.Channels != 2 {
		return nil, nil, fmt.Errorf("audio: expected 2 channels, got %d", info.Channels)
	}
	bytesPerFrame := 4
	left := make([]byte, 0, len(info.PCM)/2)
	right := make([]byte, 0, len(info.PCM)/2)
	for i := 0; i+bytesPerFrame <= len(info.PCM); i += bytesPerFrame {
		left = append(left, info.PCM[i], info.PCM[i+1])
		right = append(right, info.PCM[i+2], info.PCM[i+3])
	}
	if len(left) == 0 {
		return nil, nil, fmt.Errorf("audio: stereo file carries no frames")
	}
	return encodeWAV(info.SampleRate, left), encodeWAV(info.SampleRate, right), nil
}

// encodeWAV builds a canonical 16-bit mono RIFF/WAVE file around raw frames.
func encodeWAV(sampleRate int, frames []byte) []byte {
	blockAlign := 2
	byteRate := sampleRate * blockAlign
	var buf bytes.Buffer
	buf.Grow(44 + len(frames))
	buf.WriteString("RIFF")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(36+len(frames)))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(16))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1)) // PCM
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1)) // channels
	_ = binary.Write(&buf, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(byteRate))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(16)) // bits
	buf.WriteString("data")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(frames)))
	buf.Write(frames)
	return buf.Bytes()
}

// MergeDialogueTurns interleaves the two channel transcripts by time and
// groups each speaker's consecutive sentences into turns. gapMS is the silence
// that starts a new turn for the same speaker; <= 0 means
// DefaultDialogueGapMS.
//
// A channel that recognised nothing (a muted track, or the provider's
// "no speech" answer) contributes no turns, so a one-sided recording still
// comes back labelled by its only speaker.
func MergeDialogueTurns(left, right []TimedSentence, leftRole, rightRole string, gapMS int64) []DialogueTurn {
	if gapMS <= 0 {
		gapMS = DefaultDialogueGapMS
	}
	leftTurns := channelTurns(left, leftRole, gapMS)
	rightTurns := channelTurns(right, rightRole, gapMS)
	return mergeByTime(leftTurns, rightTurns)
}

// channelTurns groups one channel's sentences into turns.
func channelTurns(sentences []TimedSentence, speaker string, gapMS int64) []DialogueTurn {
	ordered := make([]TimedSentence, 0, len(sentences))
	for _, s := range sentences {
		if strings.TrimSpace(s.Text) == "" {
			continue
		}
		ordered = append(ordered, s)
	}
	if len(ordered) == 0 {
		return nil
	}
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].BeginMS < ordered[j].BeginMS })

	turns := make([]DialogueTurn, 0, len(ordered))
	current := DialogueTurn{Speaker: speaker, BeginMS: ordered[0].BeginMS, EndMS: ordered[0].EndMS, Text: ordered[0].Text}
	for _, s := range ordered[1:] {
		// A new turn starts when the speaker paused for longer than gapMS.
		if s.BeginMS-current.EndMS > gapMS {
			turns = append(turns, current)
			current = DialogueTurn{Speaker: speaker, BeginMS: s.BeginMS, EndMS: s.EndMS, Text: s.Text}
			continue
		}
		current.Text += s.Text
		if s.EndMS > current.EndMS {
			current.EndMS = s.EndMS
		}
	}
	turns = append(turns, current)
	return turns
}

// mergeByTime interleaves two already-ordered turn lists by start time.
func mergeByTime(a, b []DialogueTurn) []DialogueTurn {
	merged := make([]DialogueTurn, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		if a[i].BeginMS <= b[j].BeginMS {
			merged = append(merged, a[i])
			i++
			continue
		}
		merged = append(merged, b[j])
		j++
	}
	merged = append(merged, a[i:]...)
	merged = append(merged, b[j:]...)
	return merged
}
