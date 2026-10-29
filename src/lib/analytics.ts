// Browser-side analytics: privacy-safe events (see src/analytics/events.ts)
// stored only in this browser's localStorage. Nothing is sent to a server.
import { createEvent, localStorageSink } from "../analytics/events.ts";
import type { AnalyticsEvent, EventName, EventSink } from "../analytics/events.ts";

let sink: EventSink | undefined;
function getSink(): EventSink {
  if (!sink) {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    sink = localStorageSink(storage);
  }
  return sink;
}

/** Records a real event from this browser. Best-effort; never throws. */
export function track(name: EventName, props: Record<string, unknown> = {}) {
  try {
    getSink().record(createEvent(name, props));
  } catch {
    // analytics must never break the experience
  }
}

export const recordedEvents = (): AnalyticsEvent[] => getSink().list();
export const clearRecordedEvents = () => getSink().clear();
