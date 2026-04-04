export function trackPlausible(eventName: string, props?: Record<string, string>): void {
  if (typeof window === "undefined" || typeof window.plausible === "undefined") {
    return;
  }

  window.plausible(eventName, props ? { props } : undefined);
}

const timingStarts = new Map<string, number>();

export function startTiming(label: string): void {
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    return;
  }

  timingStarts.set(label, performance.now());
}

export function trackTiming(
  eventName: string,
  label: string,
  props?: Record<string, string>,
): void {
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    return;
  }

  const start = timingStarts.get(label);
  if (typeof start !== "number") {
    return;
  }

  const durationMs = Math.max(0, Math.round(performance.now() - start));
  timingStarts.delete(label);

  trackPlausible(eventName, {
    ...props,
    duration_ms: String(durationMs),
  });
}

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string> }) => void;
  }
}

export {};
