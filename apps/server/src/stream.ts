import type { FastifyInstance } from 'fastify';

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export class EventStream {
  private clients = new Set<(event: StreamEvent) => void>();

  publish(event: StreamEvent): void {
    for (const send of this.clients) {
      try {
        send(event);
      } catch {
        // Drop failed clients silently; WS close handler will clean up.
      }
    }
  }

  subscribe(send: (event: StreamEvent) => void): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }
}

export async function streamRoute(app: FastifyInstance, stream: EventStream): Promise<void> {
  app.get('/v1/stream', { websocket: true }, (socket) => {
    const unsubscribe = stream.subscribe((event) => {
      socket.send(JSON.stringify(event));
    });
    socket.on('close', unsubscribe);
  });
}
