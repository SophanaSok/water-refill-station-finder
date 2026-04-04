export function trackPlausible(eventName: string, props?: Record<string, string>): void {
  if (typeof window === "undefined" || typeof window.plausible === "undefined") {
    return;
  }

  window.plausible(eventName, props ? { props } : undefined);
}

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string> }) => void;
  }
}

export {};
