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

package service

import (
	"sync"

	"ragflow/internal/entity"
)

// QcPushEvent is the realtime QC panel push payload.
type QcPushEvent struct {
	Type string       `json:"type"` // always "qc_hit"
	Data *entity.QcHit `json:"data"`
}

// QcHub fans out QC hit events to the per-tenant WebSocket subscribers of the
// realtime panel. It is process-local: hits produced by a chat running in the
// same process are pushed directly, which covers the single-API-process
// deployment. Multi-process fan-out is left to a NATS bridge (out of MVP).
type QcHub struct {
	mu   sync.RWMutex
	subs map[string]map[chan QcPushEvent]struct{}
}

// NewQcHub creates an empty hub.
func NewQcHub() *QcHub {
	return &QcHub{subs: make(map[string]map[chan QcPushEvent]struct{})}
}

// Subscribe registers a tenant subscriber and returns its event channel plus a
// cancel function that unregisters and closes it.
func (h *QcHub) Subscribe(tenantID string) (<-chan QcPushEvent, func()) {
	ch := make(chan QcPushEvent, 64)
	h.mu.Lock()
	if h.subs[tenantID] == nil {
		h.subs[tenantID] = make(map[chan QcPushEvent]struct{})
	}
	h.subs[tenantID][ch] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			if set, ok := h.subs[tenantID]; ok {
				delete(set, ch)
				if len(set) == 0 {
					delete(h.subs, tenantID)
				}
			}
			h.mu.Unlock()
			close(ch)
		})
	}
	return ch, cancel
}

// Broadcast fans an event out to a tenant's subscribers, dropping it for slow
// consumers rather than blocking the chat path.
func (h *QcHub) Broadcast(tenantID string, ev QcPushEvent) {
	h.mu.RLock()
	set := h.subs[tenantID]
	h.mu.RUnlock()
	if set == nil {
		return
	}
	for ch := range set {
		select {
		case ch <- ev:
		default:
		}
	}
}

var (
	qcHubOnce sync.Once
	qcHub     *QcHub
)

// GetQcHub returns the process-wide QC hub singleton.
func GetQcHub() *QcHub {
	qcHubOnce.Do(func() {
		qcHub = NewQcHub()
	})
	return qcHub
}
