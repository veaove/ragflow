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

import { IQcHit } from '@/services/qc-service';
import { restAPIv1 } from '@/utils/api';
import { getAuthorization } from '@/utils/authorization-util';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface IQcPushEvent {
  type: string;
  data?: IQcHit;
}

const ReconnectDelayMs = 3000;

/**
 * useQcRealtime opens a WebSocket to /api/v1/qc/stream and forwards every
 * qc_hit push event to `onEvent`. It reconnects automatically with a fixed
 * delay and never throws — a dropped stream only means the realtime panel
 * misses events, which the hit list can still load from the database.
 *
 * NOTE: whatever reverse proxy fronts the API must forward the WebSocket
 * upgrade headers (`Upgrade` / `Connection`), otherwise the handshake fails
 * with a non-101 status and this hook retries forever.
 */
export function useQcRealtime(onEvent: (hit: IQcHit) => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | undefined>(undefined);
  // Guards the reconnect chain. The previous version scheduled the next attempt
  // from inside the socket's own closure, so the cleanup returned to the effect
  // could only cancel the FIRST timer — a closed page kept reconnecting every
  // 3s indefinitely.
  const disposedRef = useRef(false);

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    const token = getAuthorization();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}${restAPIv1}/qc/stream?token=${encodeURIComponent(token)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!disposedRef.current) setConnected(true);
    };
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as IQcPushEvent;
        if (event?.type === 'qc_hit' && event.data) {
          onEventRef.current(event.data);
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (disposedRef.current) return;
      setConnected(false);
      retryTimerRef.current = window.setTimeout(connect, ReconnectDelayMs);
    };
    ws.onerror = () => {
      // onclose always follows onerror; closing here keeps retries in one place.
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      disposedRef.current = true;
      if (retryTimerRef.current !== undefined) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = undefined;
      }
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [connect]);

  return { connected };
}
