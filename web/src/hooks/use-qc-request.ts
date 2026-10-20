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

/**
 * useQcRealtime opens a WebSocket to /api/v1/qc/stream and forwards every
 * qc_hit push event to `onEvent`. It reconnects automatically with a short
 * backoff and never throws — a dropped stream only means the realtime panel
 * misses events, which the hit list can still load from the database.
 */
export function useQcRealtime(onEvent: (hit: IQcHit) => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAuthorization();
    if (!token) return () => {};
    const url = `${protocol}//${window.location.host}${restAPIv1}/qc/stream?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return () => {};
    }
    let closed = false;
    let retryTimer: number | undefined;

    ws.onopen = () => setConnected(true);
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
      setConnected(false);
      if (!closed) {
        retryTimer = window.setTimeout(connect, 3000);
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  return { connected };
}
