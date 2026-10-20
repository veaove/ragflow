package dataset

import (
	"strings"
	"testing"
)

func TestJSONColumnContains(t *testing.T) {
	const datasetID = "0123456789abcdef0123456789abcdef"

	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{
			name: "kb_ids array holds the dataset",
			raw:  `["` + datasetID + `","feddba9876543210fedcba9876543210"]`,
			want: true,
		},
		{
			name: "canvas dsl holds the dataset in a retrieval node",
			raw:  `{"components":[{"obj":{"component_name":"Retrieval","params":{"kb_ids":["` + datasetID + `"]}}}]}`,
			want: true,
		},
		{
			name: "other dataset ids do not match",
			raw:  `["feddba9876543210fedcba9876543210"]`,
			want: false,
		},
		{
			// A LIKE query matching on the id prefix must not be reported as a
			// reference once the raw value is checked.
			name: "prefix of the id is not a reference",
			raw:  `["0123456789abcdef0123456789abcde"]`,
			want: false,
		},
		{
			name: "empty column",
			raw:  "",
			want: false,
		},
		{
			name: "double encoded json column",
			raw:  `"[\"` + datasetID + `\"]"`,
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := jsonColumnContains(tt.raw, `"`+datasetID+`"`); got != tt.want {
				t.Fatalf("jsonColumnContains(%q) = %v, want %v", tt.raw, got, tt.want)
			}
		})
	}
}

func TestDatasetReferencedErrorNamesEveryBinding(t *testing.T) {
	err := &DatasetReferencedError{References: []DatasetReference{
		{Kind: DatasetReferenceKindChat, ID: "chat-1", Name: "客服助手"},
		{Kind: DatasetReferenceKindAgent, ID: "agent-1"},
	}}

	message := err.Error()
	for _, want := range []string{"客服助手", "agent-1", "unbind it before disabling"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error message %q is missing %q", message, want)
		}
	}
}
