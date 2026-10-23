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

import { restAPIv1 } from '@/utils/api';
import request from '@/utils/request';

/** Which execution chain produced a consultation session. */
export type AnalyticsChain = 'chat' | 'canvas';
export type AnalyticsRating = 'good' | 'bad' | 'none';

export interface IConsultationLogItem {
  chain: AnalyticsChain;
  session_id: string;
  customer_id: string;
  app_id: string;
  app_name: string;
  /**
   * Shape of the application: "chat" for a dialog-backed chat app, or the
   * studio canvas category (agent_canvas / workflow_canvas /
   * chatflow_canvas / dataflow_canvas).
   */
  app_type: string;
  start_time: number;
  rounds: number;
  rating: AnalyticsRating;
  feedback?: string;
  duration_ms: number;
  first_question: string;
}

export interface IConsultationTurn {
  position: number;
  role: string;
  content: string;
  thumb_up?: boolean;
  feedback?: string;
  duration_ms: number;
  created_at: number;
}

export interface IConsultationDetail {
  chain: AnalyticsChain;
  session_id: string;
  customer_id: string;
  app_id: string;
  app_name: string;
  start_time: number;
  rounds: number;
  duration_ms: number;
  turns: IConsultationTurn[];
}

export interface IConsultationQuery {
  from?: string;
  to?: string;
  app_id?: string;
  rating?: string;
  keyword?: string;
  customer_id?: string;
  page?: number;
  size?: number;
}

export interface IAnalyticsMetrics {
  consultations: number;
  customers: number;
  /** null when the window has no measured latency for that chain. */
  response_ms: { chat: number | null; canvas: number | null };
  good_rate: number | null;
  success_rate: number | null;
  avg_rounds: number;
  bad_count: number;
}

export interface IAnalyticsStats {
  from: number;
  to: number;
  metrics: IAnalyticsMetrics;
  deltas: {
    consultations?: number;
    customers?: number;
    good_rate?: number;
    success_rate?: number;
  };
}

export interface IAnalyticsTrendPoint {
  date: string;
  consultations: number;
  customers: number;
  good_rate: number | null;
}

export interface IAnalyticsAppRow {
  app_id: string;
  app_name: string;
  chain: AnalyticsChain;
  consultations: number;
  customers: number;
  response_ms: number;
  good_rate: number | null;
}

export interface IAnalyticsRange {
  from?: string;
  to?: string;
  app_id?: string;
}

const base = `${restAPIv1}/analytics`;

export const analyticsService = {
  listConsultations: (params: IConsultationQuery) =>
    request.get(`${base}/consultations`, { params }),

  getConsultation: (sessionId: string, chain: AnalyticsChain) =>
    request.get(`${base}/consultations/${sessionId}`, { params: { chain } }),

  getStats: (params: IAnalyticsRange) =>
    request.get(`${base}/stats`, { params }),

  getTrend: (params: IAnalyticsRange) =>
    request.get(`${base}/stats/trend`, { params }),

  getApps: (params: IAnalyticsRange) =>
    request.get(`${base}/stats/apps`, { params }),

  exportUrl: (params: IConsultationQuery) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return `${base}/consultations/export?${qs.toString()}`;
  },
};
