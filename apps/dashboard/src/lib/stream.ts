/**
 * Thin WS client for `/v1/stream`. The server publishes every event onto the
 * same socket; callers filter by `event.type` (e.g. `admin.audit`, `claim`).
 *
 * Auto-reconnect with exponential backoff (capped at 30 s) so the overview
 * counters and audit log recover from transient drops.
 */
import { onBeforeUnmount, onMounted } from 'vue';

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export type StreamHandler = (event: StreamEvent) => void;

export function useAdminStream(onEvent: StreamHandler): void {
  let socket: WebSocket | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const connect = (): void => {
    if (disposed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/v1/stream`;
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const parsed = JSON.parse(ev.data) as StreamEvent;
        if (parsed && typeof parsed.type === 'string') {
          onEvent(parsed);
        }
      } catch {
        // ignore malformed frames
      }
    };
    socket.onopen = () => {
      retry = 0;
    };
    socket.onclose = () => {
      scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket?.close();
      } catch {
        // ignore
      }
    };
  };

  const scheduleReconnect = (): void => {
    if (disposed) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(retry, 6));
    retry += 1;
    timer = setTimeout(connect, delay);
  };

  onMounted(() => {
    connect();
  });
  onBeforeUnmount(() => {
    disposed = true;
    if (timer) clearTimeout(timer);
    try {
      socket?.close();
    } catch {
      // ignore
    }
  });
}
