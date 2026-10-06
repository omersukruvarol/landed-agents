import type { LiveEvent } from "@landed/ingest";

/** Fan-out of live events to connected dashboards (Server-Sent Events). */
export interface Hub {
  publish(e: LiveEvent): void;
  subscribe(listener: (e: LiveEvent) => void): () => void;
  readonly size: number;
}

export function createHub(): Hub {
  const listeners = new Set<(e: LiveEvent) => void>();
  return {
    publish(e) {
      for (const l of listeners) {
        try {
          l(e);
        } catch {
          listeners.delete(l);
        }
      }
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get size() {
      return listeners.size;
    },
  };
}
