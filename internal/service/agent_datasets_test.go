package service

import (
	"slices"
	"testing"

	"ragflow/internal/entity"
)

// DSL 的结构随画布类型和版本漂移，绑定关系可能落在节点 form、组件 obj.params、
// 或工具列表的 params 里。这个用例把三种已知形状都钉住。
func TestCanvasDatasetIDsCollectsEveryBindingShape(t *testing.T) {
	dsl := entity.JSONMap{
		"components": map[string]interface{}{
			"Retrieval:1": map[string]interface{}{
				"obj": map[string]interface{}{
					"params": map[string]interface{}{
						"dataset_ids": []interface{}{"kb-component"},
					},
				},
			},
		},
		"graph": map[string]interface{}{
			"nodes": []interface{}{
				map[string]interface{}{
					"data": map[string]interface{}{
						"form": map[string]interface{}{
							"dataset_ids": []interface{}{"kb-node"},
							"tools": []interface{}{
								map[string]interface{}{
									"params": map[string]interface{}{
										// 老数据用 kb_ids
										"kb_ids": []interface{}{"kb-tool"},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	got := canvasDatasetIDs(dsl)
	want := []string{"kb-component", "kb-node", "kb-tool"}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("canvasDatasetIDs = %v, want %v", got, want)
	}
}

func TestCanvasDatasetIDsDeduplicatesAndSkipsJunk(t *testing.T) {
	dsl := entity.JSONMap{
		"graph": map[string]interface{}{
			"nodes": []interface{}{
				map[string]interface{}{
					"data": map[string]interface{}{
						"form": map[string]interface{}{
							"dataset_ids": []interface{}{"kb-1", "", "kb-1", 7, nil},
						},
					},
				},
				map[string]interface{}{
					"data": map[string]interface{}{
						"form": map[string]interface{}{
							"dataset_ids": []interface{}{"kb-1", "kb-2"},
						},
					},
				},
			},
		},
	}

	got := canvasDatasetIDs(dsl)
	if !slices.Equal(got, []string{"kb-1", "kb-2"}) {
		t.Fatalf("canvasDatasetIDs = %v, want [kb-1 kb-2]", got)
	}
}

// 历史画布把 components 存成 JSON 字符串，不解析会漏掉绑定。
func TestCanvasDatasetIDsParsesJSONStringNodes(t *testing.T) {
	dsl := entity.JSONMap{
		"components": `{"Retrieval:1":{"obj":{"params":{"dataset_ids":["kb-embedded"]}}}}`,
	}

	got := canvasDatasetIDs(dsl)
	if !slices.Equal(got, []string{"kb-embedded"}) {
		t.Fatalf("canvasDatasetIDs = %v, want [kb-embedded]", got)
	}
}

func TestCanvasDatasetIDsWithoutBindings(t *testing.T) {
	shapes := []entity.JSONMap{
		nil,
		{},
		{"graph": map[string]interface{}{"nodes": []interface{}{}}},
		// 绑定了记忆库不算知识库
		{"components": map[string]interface{}{
			"Retrieval:1": map[string]interface{}{
				"obj": map[string]interface{}{
					"params": map[string]interface{}{
						"memory_ids": []interface{}{"mem-1"},
					},
				},
			},
		}},
	}

	for _, dsl := range shapes {
		if got := canvasDatasetIDs(dsl); len(got) != 0 {
			t.Fatalf("canvasDatasetIDs(%v) = %v, want empty", dsl, got)
		}
	}
}
