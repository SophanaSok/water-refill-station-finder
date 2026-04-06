const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN?.trim();

export function initAnalytics(): void {
  if (typeof window === "undefined" || !PLAUSIBLE_DOMAIN) {
    return;
  }

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return;
  }

  if (document.querySelector("script[data-plausible-loader='true']")) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://plausible.io/js/script.js";
  script.setAttribute("data-domain", PLAUSIBLE_DOMAIN);
  script.setAttribute("data-plausible-loader", "true");
  document.head.appendChild(script);
}

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
