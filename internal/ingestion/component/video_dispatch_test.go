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

package component

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	modelModule "ragflow/internal/entity/models"
	"ragflow/internal/ingestion/component/schema"
	"ragflow/internal/utility"
)

func TestMaybeDispatchVideoIgnoresNonVideo(t *testing.T) {
	_, dispatched, err := maybeDispatchVideo(
		t.Context(), dao.DB, utility.FileTypeAURAL, "clip.mp3", []byte("audio"),
		map[string]any{"tenant_id": "t1"}, defaultSetups(), visionSettings{},
	)
	if dispatched {
		t.Fatal("video dispatch must not claim a non-video file")
	}
	if err != nil {
		t.Fatalf("unexpected error for non-video file: %v", err)
	}
}

func TestMaybeDispatchVideoNeedsVideoSetup(t *testing.T) {
	_, dispatched, err := maybeDispatchVideo(
		t.Context(), dao.DB, utility.FileTypeVIDEO, "clip.mp4", []byte("video"),
		map[string]any{"tenant_id": "t1"}, map[string]schema.ParserSetup{}, visionSettings{},
	)
	if dispatched {
		t.Fatal("without a video setup the batch parser path must stay in charge")
	}
	if err != nil {
		t.Fatalf("unexpected error without a video setup: %v", err)
	}
}

func TestMaybeDispatchVideoRejectsMissingInputs(t *testing.T) {
	for _, tc := range []struct {
		name    string
		payload []byte
		inputs  map[string]any
		want    string
	}{
		{"no-tenant", []byte("video"), map[string]any{}, "tenant_id"},
		{"empty-payload", nil, map[string]any{"tenant_id": "t1"}, "payload is empty"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, dispatched, err := maybeDispatchVideo(
				t.Context(), dao.DB, utility.FileTypeVIDEO, "clip.mp4", tc.payload,
				tc.inputs, defaultSetups(), visionSettings{},
			)
			if !dispatched {
				t.Fatal("a VIDEO file with a video setup must be claimed")
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestDescribeVideoFramesNeedsVisionModel(t *testing.T) {
	original := resolveTenantModelByType
	t.Cleanup(func() { resolveTenantModelByType = original })
	resolveTenantModelByType = func(context.Context, *gorm.DB, string, entity.ModelType) (modelModule.ModelDriver, string, *modelModule.APIConfig, int, error) {
		return nil, "", nil, 0, errors.New("no model configured")
	}

	_, warnings, err := describeVideoFrames(
		t.Context(), dao.DB, "ffmpeg", t.TempDir(), "source.mp4", "t1",
		schema.ParserSetup{}, map[string]any{}, visionSettings{},
	)
	if err == nil || !strings.Contains(err.Error(), "vision model") {
		t.Fatalf("error = %v, want a vision-model resolution failure", err)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want none before frame extraction", warnings)
	}
}

func TestMergeVideoPartsOrdersByTimestamp(t *testing.T) {
	got := mergeVideoParts([]videoPart{
		{StartMS: 72_000, Text: "画面: 后"},
		{StartMS: 0, Text: "开场"},
		{StartMS: 3_661_000, Text: "结尾"},
	})
	want := "[00:00:00] 开场\n[00:01:12] 画面: 后\n[01:01:01] 结尾"
	if got != want {
		t.Fatalf("merged transcript = %q, want %q", got, want)
	}
}

func TestMergeVideoPartsDoesNotReorderCallerSlice(t *testing.T) {
	parts := []videoPart{{StartMS: 5_000, Text: "later"}, {StartMS: 1_000, Text: "earlier"}}
	_ = mergeVideoParts(parts)
	if parts[0].StartMS != 5_000 || parts[1].StartMS != 1_000 {
		t.Fatalf("mergeVideoParts mutated its input: %#v", parts)
	}
}

func TestFormatVideoTimestamp(t *testing.T) {
	cases := map[int64]string{
		-1:        "00:00:00",
		0:         "00:00:00",
		999:       "00:00:00",
		1_000:     "00:00:01",
		61_000:    "00:01:01",
		3_599_000: "00:59:59",
		3_600_000: "01:00:00",
		3_661_000: "01:01:01",
	}
	for ms, want := range cases {
		if got := formatVideoTimestamp(ms); got != want {
			t.Errorf("formatVideoTimestamp(%d) = %q, want %q", ms, got, want)
		}
	}
}

func TestVideoFrameLabel(t *testing.T) {
	cases := map[string]string{
		"Chinese":  "画面",
		"zh":       "画面",
		"zh-CN":    "画面",
		"中文":       "画面",
		"English":  "Frame",
		"Japanese": "Frame",
		"":         "Frame",
	}
	for language, want := range cases {
		if got := videoFrameLabel(language); got != want {
			t.Errorf("videoFrameLabel(%q) = %q, want %q", language, got, want)
		}
	}
}

func TestVideoFrameInterval(t *testing.T) {
	// maxVideoFrames is 20 and the default gap is 10s, so anything under 200s
	// keeps the default and longer recordings stretch the gap to stay covered.
	cases := map[float64]int{
		-1:  videoFrameIntervalSeconds,
		0:   videoFrameIntervalSeconds,
		200: videoFrameIntervalSeconds,
		400: 20,
		624: 32,
	}
	for duration, want := range cases {
		if got := videoFrameInterval(duration); got != want {
			t.Errorf("videoFrameInterval(%v) = %d, want %d", duration, got, want)
		}
	}
}

func TestVideoFileExtension(t *testing.T) {
	cases := map[string]string{
		"clip.MP4":     ".mp4",
		"clip.mkv":     ".mkv",
		"/tmp/a/b.mov": ".mov",
		"no-extension": ".mp4",
	}
	for filename, want := range cases {
		if got := videoFileExtension(filename); got != want {
			t.Errorf("videoFileExtension(%q) = %q, want %q", filename, got, want)
		}
	}
}
