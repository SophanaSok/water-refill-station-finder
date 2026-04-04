/// <reference lib="webworker" />

type ConnectivityMessage = {
  type: "connectivity";
  online: boolean;
};

type CacheEntry = {
  url: string;
  timestamp: number;
};

const PRECACHE_NAME = "pwa-precache-v1";
const STATIONS_CACHE_NAME = "stations-cache";
const TILES_CACHE_NAME = "map-tiles";
const CACHE_DB_NAME = "pwa-cache-metadata-v1";
const CACHE_DB_VERSION = 1;
const STATIONS_CACHE_LIMIT = 20;
const TILES_CACHE_LIMIT = 500;
const TILES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAPLIBRE_CSS_URL = "https://unpkg.com/maplibre-gl/dist/maplibre-gl.css";
const MAPLIBRE_JS_URL = "https://unpkg.com/maplibre-gl/dist/maplibre-gl.js";
const OPENFREE_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FONTSHARE_CSS_URL = "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap";
const APP_ICON_URLS = ["/icons/icon-192.png", "/icons/icon-512.png"];

const sw = self as unknown as ServiceWorkerGlobalScope;

let connectivityOnline = true;

sw.oninstall = (event) => {
  event.waitUntil((async () => {
    await precacheAppShell();
    await sw.skipWaiting();
  })());
};

sw.onactivate = (event) => {
  event.waitUntil(sw.clients.claim());
};

sw.onfetch = (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (shouldUsePrecache(requestUrl)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (requestUrl.origin !== sw.location.origin && requestUrl.hostname !== "tiles.openfreemap.org") {
    return;
  }

  if (isStationsRequest(requestUrl)) {
    event.respondWith(handleStationsRequest(event.request));
    return;
  }

  if (requestUrl.hostname === "tiles.openfreemap.org") {
    event.respondWith(handleTileRequest(event.request));
    return;
  }

  event.respondWith(networkOnly(event.request));
};

async function precacheAppShell() {
  const cache = await caches.open(PRECACHE_NAME);
  const rootUrl = new URL("/", sw.location.origin).toString();
  const urlsToCache = new Set<string>([
    rootUrl,
    FONTSHARE_CSS_URL,
    MAPLIBRE_CSS_URL,
    MAPLIBRE_JS_URL,
    OPENFREE_MAP_STYLE_URL,
    ...APP_ICON_URLS,
  ]);

  const rootResponse = await fetch(new Request(rootUrl, { cache: "reload" }));
  if (rootResponse.ok || rootResponse.type === "opaque") {
    await cache.put(rootUrl, rootResponse.clone());

    const html = await rootResponse.clone().text();
    for (const assetUrl of extractAssetUrls(html)) {
      urlsToCache.add(assetUrl);
    }
  }

  await Promise.all(
    Array.from(urlsToCache).map(async (url) => {
      try {
        const response = await fetch(url, getFetchInit(url));

        if (response.ok || response.type === "opaque") {
          await cache.put(url, response.clone());
        }
      } catch {
        // Ignore individual precache failures so install can still succeed.
      }
    }),
  );
}

function extractAssetUrls(html: string): string[] {
  const urls = new Set<string>();
  const stylesheetPattern = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const scriptPattern = /<script[^>]+type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(stylesheetPattern)) {
    const href = match[1];
    if (href) {
      urls.add(new URL(href, sw.location.origin).toString());
    }
  }

  for (const match of html.matchAll(scriptPattern)) {
    const src = match[1];
    if (src) {
      urls.add(new URL(src, sw.location.origin).toString());
    }
  }

  return Array.from(urls);
}

function shouldUsePrecache(requestUrl: URL): boolean {
  return (
    requestUrl.origin === sw.location.origin &&
    (requestUrl.pathname === "/" || requestUrl.pathname.startsWith("/assets/") || requestUrl.pathname.startsWith("/icons/"))
  ) ||
  requestUrl.toString() === MAPLIBRE_CSS_URL ||
  requestUrl.toString() === MAPLIBRE_JS_URL ||
  requestUrl.toString() === OPENFREE_MAP_STYLE_URL ||
  requestUrl.toString() === FONTSHARE_CSS_URL;
}

function isStationsRequest(url: URL): boolean {
  return url.origin === self.location.origin && url.pathname === "/api/stations";
}

function getFetchInit(url: string): RequestInit {
  return new URL(url).origin === sw.location.origin ? { cache: "no-cache" } : { mode: "no-cors" };
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(PRECACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
  }

  return response;
}

async function networkOnly(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    setConnectivityState(true);
    return response;
  } catch (error) {
    setConnectivityState(false);
    throw error;
  }
}

async function handleStationsRequest(request: Request): Promise<Response> {
  const cache = await caches.open(STATIONS_CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await upsertCacheEntry(STATIONS_CACHE_NAME, request.url);
      await pruneCacheEntries(STATIONS_CACHE_NAME, STATIONS_CACHE_LIMIT);
      setConnectivityState(true);
    }

    return response;
  } catch (error) {
    setConnectivityState(false);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    throw error;
  }
}

async function handleTileRequest(request: Request): Promise<Response> {
  const cache = await caches.open(TILES_CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    void pruneCacheEntries(TILES_CACHE_NAME, TILES_CACHE_LIMIT, TILES_MAX_AGE_MS);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
      await upsertCacheEntry(TILES_CACHE_NAME, request.url);
      await pruneCacheEntries(TILES_CACHE_NAME, TILES_CACHE_LIMIT, TILES_MAX_AGE_MS);
    }

    setConnectivityState(true);
    return response;
  } catch (error) {
    setConnectivityState(false);
    throw error;
  }
}

function setConnectivityState(online: boolean) {
  if (connectivityOnline === online) {
    return;
  }

  connectivityOnline = online;
  const message: ConnectivityMessage = { type: "connectivity", online };

  void sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients: ReadonlyArray<Client>) => {
    clients.forEach((client) => {
      client.postMessage(message);
    });
  });
}

async function openMetadataDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATIONS_CACHE_NAME)) {
        db.createObjectStore(STATIONS_CACHE_NAME, { keyPath: "url" });
      }
      if (!db.objectStoreNames.contains(TILES_CACHE_NAME)) {
        db.createObjectStore(TILES_CACHE_NAME, { keyPath: "url" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function upsertCacheEntry(storeName: string, url: string): Promise<void> {
  const db = await openMetadataDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({ url, timestamp: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
}

async function pruneCacheEntries(storeName: string, maxEntries: number, maxAgeMs?: number): Promise<void> {
  const db = await openMetadataDb();
  const entries = await new Promise<CacheEntry[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as CacheEntry[]);
    request.onerror = () => reject(request.error);
  });

  const now = Date.now();
  const validEntries = maxAgeMs ? entries.filter((entry) => now - entry.timestamp <= maxAgeMs) : entries;
  const expiredEntries = maxAgeMs ? entries.filter((entry) => now - entry.timestamp > maxAgeMs) : [];
  const sortedEntries = [...validEntries].sort((a, b) => a.timestamp - b.timestamp);
  const excessEntries = Math.max(0, sortedEntries.length - maxEntries);
  const urlsToDelete = new Set<string>([
    ...expiredEntries.map((entry) => entry.url),
    ...sortedEntries.slice(0, excessEntries).map((entry) => entry.url),
  ]);

  if (urlsToDelete.size === 0) {
    db.close();
    return;
  }

  const cache = await caches.open(storeName);
  await Promise.all(Array.from(urlsToDelete).map(async (url) => cache.delete(url)));

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    Array.from(urlsToDelete).forEach((url) => {
      store.delete(url);
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  db.close();
}
