package service

import (
	"strings"
	"testing"
)

func TestValidateMemoryTypesRequiresRaw(t *testing.T) {
	cases := []struct {
		name    string
		in      []string
		wantErr string
		want    map[string]bool
	}{
		{
			name: "raw only",
			in:   []string{"raw"},
			want: map[string]bool{"raw": true},
		},
		{
			name: "all four, mixed case",
			in:   []string{"RAW", "Semantic", "episodic", "procedural"},
			want: map[string]bool{"raw": true, "semantic": true, "episodic": true, "procedural": true},
		},
		{
			name:    "semantic only is refused",
			in:      []string{"semantic"},
			wantErr: "raw",
		},
		{
			name:    "the 14 set that used to slip through is refused",
			in:      []string{"semantic", "episodic", "procedural"},
			wantErr: "raw",
		},
		{
			name:    "empty list is refused",
			in:      nil,
			wantErr: "raw",
		},
		{
			name:    "unknown type names the offender",
			in:      []string{"raw", "working"},
			wantErr: "'working' is not supported",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateMemoryTypes(tc.in)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("validateMemoryTypes(%v) = %v, want an error containing %q", tc.in, got, tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("error = %q, want it to contain %q", err.Error(), tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateMemoryTypes(%v) returned %v", tc.in, err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("validateMemoryTypes(%v) = %v, want %v", tc.in, got, tc.want)
			}
			for k := range tc.want {
				if !got[k] {
					t.Errorf("validateMemoryTypes(%v) is missing %q", tc.in, k)
				}
			}
		})
	}
}
