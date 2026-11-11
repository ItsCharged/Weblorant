export type EventHandler<TPayload> = (payload: TPayload) => void;

export class EventBus<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<EventHandler<never>>>();

  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler as EventHandler<never>);
    return () => {
      this.off(event, handler);
    };
  }

  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler as EventHandler<never>);
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      (handler as EventHandler<TEvents[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
