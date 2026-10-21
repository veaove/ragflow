/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

package entity

// Analytics chain identifiers. Consultation records live in two independent
// tables: the chat pipeline writes conversation/conversation_message, while
// the agent canvas runtime writes api_4_conversation/api_4_conversation_message.
// Analytics reads both and folds them into the structures below so callers do
// not have to know which chain produced a session.
const (
	AnalyticsChainChat   = "chat"
	AnalyticsChainCanvas = "canvas"
)

// Rating values for a consultation session.
const (
	AnalyticsRatingGood = "good"
	AnalyticsRatingBad  = "bad"
	AnalyticsRatingNone = "none"
)

// ConsultationLogItem is one row of the consultation log list.
type ConsultationLogItem struct {
	Chain         string `json:"chain"`
	SessionID     string `json:"session_id"`
	CustomerID    string `json:"customer_id"`
	AppID         string `json:"app_id"`
	AppName       string `json:"app_name"`
	StartTime     int64  `json:"start_time"` // UnixMilli
	Rounds        int    `json:"rounds"`
	Rating        string `json:"rating"`
	Feedback      string `json:"feedback,omitempty"`
	DurationMS    int    `json:"duration_ms"`
	FirstQuestion string `json:"first_question"`
}

// ConsultationTurn is one message inside a session detail.
type ConsultationTurn struct {
	Position   int      `json:"position"`
	Role       string   `json:"role"`
	Content    string   `json:"content"`
	ThumbUp    *bool    `json:"thumb_up,omitempty"`
	Feedback   string   `json:"feedback,omitempty"`
	DurationMS int      `json:"duration_ms"`
	CreatedAt  float64  `json:"created_at"`
	References []string `json:"references,omitempty"`
}

// ConsultationDetail is the full transcript of one session.
type ConsultationDetail struct {
	Chain      string             `json:"chain"`
	SessionID  string             `json:"session_id"`
	CustomerID string             `json:"customer_id"`
	AppID      string             `json:"app_id"`
	AppName    string             `json:"app_name"`
	StartTime  int64              `json:"start_time"`
	Rounds     int                `json:"rounds"`
	DurationMS int                `json:"duration_ms"`
	Turns      []ConsultationTurn `json:"turns"`
}

// AnalyticsResponseMetrics carries the headline numbers for the report page.
// ResponseMS is split per chain on purpose: the chat pipeline records
// first-token latency while the canvas runtime records total run duration, so
// blending the two would produce a number that means nothing.
type AnalyticsResponseMetrics struct {
	Chat   float64 `json:"chat"`
	Canvas float64 `json:"canvas"`
}

// AnalyticsMetrics is the metric block returned by the stats endpoint.
type AnalyticsMetrics struct {
	Consultations int                      `json:"consultations"`
	Customers     int                      `json:"customers"`
	ResponseMS    AnalyticsResponseMetrics `json:"response_ms"`
	GoodRate      *float64                 `json:"good_rate"`
	SuccessRate   *float64                 `json:"success_rate"`
	AvgRounds     float64                  `json:"avg_rounds"`
	Tokens        int64                    `json:"tokens"`
}

// AnalyticsDeltas is the period-over-period change for each headline metric.
type AnalyticsDeltas struct {
	Consultations *float64 `json:"consultations,omitempty"`
	Customers     *float64 `json:"customers,omitempty"`
	GoodRate      *float64 `json:"good_rate,omitempty"`
	SuccessRate   *float64 `json:"success_rate,omitempty"`
}

// AnalyticsStats is the payload of GET /analytics/stats.
type AnalyticsStats struct {
	From    int64            `json:"from"`
	To      int64            `json:"to"`
	Metrics AnalyticsMetrics `json:"metrics"`
	Deltas  AnalyticsDeltas  `json:"deltas"`
}

// AnalyticsTrendPoint is one day in the trend series.
type AnalyticsTrendPoint struct {
	Date          string   `json:"date"` // YYYY-MM-DD
	Consultations int      `json:"consultations"`
	Customers     int      `json:"customers"`
	GoodRate      *float64 `json:"good_rate"`
}

// AnalyticsTrend is the payload of GET /analytics/stats/trend.
type AnalyticsTrend struct {
	Points []AnalyticsTrendPoint `json:"points"`
}

// AnalyticsAppRow is one row of the per-app breakdown.
type AnalyticsAppRow struct {
	AppID         string   `json:"app_id"`
	AppName       string   `json:"app_name"`
	Chain         string   `json:"chain"`
	Consultations int      `json:"consultations"`
	Customers     int      `json:"customers"`
	ResponseMS    float64  `json:"response_ms"`
	GoodRate      *float64 `json:"good_rate"`
}

// AnalyticsAppStats is the payload of GET /analytics/stats/apps.
type AnalyticsAppStats struct {
	Rows []AnalyticsAppRow `json:"rows"`
}
