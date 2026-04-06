import type { MapController } from "./map";
import { ApiErrorResponse, fetchStations, geocodeSearch, fetchStationById } from "./api";
import { openStationDetail, updateUserLocation, loadSavedStations } from "./stationDetail";
import { initializeAuth } from "./auth";
import { initAnalytics, startTiming, trackPlausible, trackTiming } from "./analytics";
import { renderNoStationsEmptyState, renderSearchNoResultsEmptyState } from "./emptyStates";
import { getStationTypeIcon as getStationTypeIconMarkup } from "./icons";
import { showStationDetailLoading } from "./stationDetail";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

// ============================================================================
// UI State
// ============================================================================

let isSearchingThisArea = false;
let lastGeolocationResult: { lat: number; lng: number } | null = null;
let savedStationsModulePromise: Promise<typeof import("./savedStations")> | null = null;
let profileModulePromise: Promise<typeof import("./profile")> | null = null;
let hasTrackedFirstStationsLoad = false;
let mapStateFreshTimer: ReturnType<typeof setTimeout> | null = null;

const NEARBY_SEARCH_RADIUS_METERS = 32187;

function getNearestStationId(geojson: Awaited<ReturnType<typeof fetchStations>>): string | null {
  const firstFeature = geojson.features[0];
  const stationId = firstFeature?.properties?.id;
  return typeof stationId === "string" ? stationId : null;
}

async function openNearestStationIfAvailable(geojson: Awaited<ReturnType<typeof fetchStations>>): Promise<void> {
  const nearestStationId = getNearestStationId(geojson);
  if (!nearestStationId) {
    return;
  }

  await handleMapClick(nearestStationId);
}

function showNoNearbyStationsMessage() {
  const sheet = document.querySelector<HTMLElement>(".bottom-sheet");
  const content = sheet?.querySelector<HTMLElement>(".content");
  if (!sheet || !content) {
    return;
  }

  sheet.setAttribute("data-state", "half");
  content.innerHTML = `
    <article class="station-card">
      <div class="skeleton" style="width: 100%; aspect-ratio: 1 / 1;"></div>
      <div>
        <h2 style="font-size: var(--text-md);">No nearby stations found</h2>
        <p style="color: var(--color-text-muted); margin-top: var(--space-1);">
          We searched up to 20 miles from your location. Try moving the map and tapping Search this area.
        </p>
      </div>
    </article>
  `;
}

async function fetchStationsWithNearbyFallback(lat: number, lng: number) {
  return fetchStations({ lat, lng, radius: NEARBY_SEARCH_RADIUS_METERS });
}

function trackFirstStationsLoad(stationCount: number) {
  if (hasTrackedFirstStationsLoad) {
    return;
  }

  hasTrackedFirstStationsLoad = true;
  trackTiming("perf_first_stations_loaded", "map_init_to_first_stations", {
    station_count: String(stationCount),
  });
}

function getSavedStationsModule() {
  savedStationsModulePromise ??= import("./savedStations");
  return savedStationsModulePromise;
}

function getProfileModule() {
  profileModulePromise ??= import("./profile");
  return profileModulePromise;
}

function syncSavedStationsMapInstance(map: MapController) {
  if (!savedStationsModulePromise) {
    return;
  }

  void savedStationsModulePromise.then(({ setMapInstance }) => {
    setMapInstance(map);
  });
}

function syncSavedStationsGeolocation(lat: number, lng: number) {
  if (!savedStationsModulePromise) {
    return;
  }

  void savedStationsModulePromise.then(({ setLastGeolocation }) => {
    setLastGeolocation(lat, lng);
  });
}

async function openSavedStationsOverlay() {
  const savedStations = await getSavedStationsModule();

  if (mapInstance) {
    savedStations.setMapInstance(mapInstance);
  }

  if (lastGeolocationResult) {
    savedStations.setLastGeolocation(lastGeolocationResult.lat, lastGeolocationResult.lng);
  }

  const { openSavedStationsSheet } = savedStations;
  openSavedStationsSheet();
}

async function openProfileOverlay() {
  const { openProfileSheet } = await getProfileModule();
  openProfileSheet();
}

function setOfflineBanner(offline: boolean) {
  const banner = document.querySelector<HTMLDivElement>("#offline-banner");
  if (!banner) return;

  banner.style.display = offline ? "flex" : "none";
  banner.setAttribute("aria-hidden", offline ? "false" : "true");
}

function initConnectivityBanner() {
  const syncBanner = () => setOfflineBanner(!navigator.onLine);

  window.addEventListener("online", syncBanner);
  window.addEventListener("offline", syncBanner);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data as { type?: string; online?: boolean } | undefined;

      if (data?.type === "connectivity" && typeof data.online === "boolean") {
        setOfflineBanner(!data.online);
      }
    });
  }

  syncBanner();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  }
}

function waitForMapBootstrapSignal(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const eventNames: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "wheel"];

    const finish = () => {
      if (settled) return;
      settled = true;

      eventNames.forEach((eventName) => {
        window.removeEventListener(eventName, finish);
      });

      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }

      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }

      resolve();
    };

    eventNames.forEach((eventName) => {
      window.addEventListener(eventName, finish, { once: true, passive: true });
    });

    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(() => {
        finish();
      }, { timeout: 700 });
      return;
    }

    timeoutHandle = setTimeout(() => {
      finish();
    }, 200);
  });
}

// ============================================================================
// DOM Utilities
// ============================================================================

function getElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

function showUserSearchStatus(message: string) {
  const stateBar = document.querySelector<HTMLElement>("#map-state-bar");
  const stateText = document.querySelector<HTMLElement>("#map-state-text");
  if (!stateBar || !stateText) return;

  stateText.textContent = `Showing: ${message}`;
  stateBar.classList.remove("is-fresh");
  // Restart highlight animation each time search is applied.
  window.requestAnimationFrame(() => {
    stateBar.classList.add("is-fresh");
  });

  if (mapStateFreshTimer) {
    clearTimeout(mapStateFreshTimer);
  }

  mapStateFreshTimer = setTimeout(() => {
    stateBar.classList.remove("is-fresh");
  }, 3000);
}

function updateFilterToggleSummary() {
  const toggle = document.querySelector<HTMLButtonElement>(".filter-pills__toggle");
  const countBadge = document.querySelector<HTMLElement>("#filter-toggle-count");
  if (!toggle || !countBadge) return;

  const activeCount = Array.from(document.querySelectorAll<HTMLButtonElement>(".filter-pill[aria-pressed='true']"))
    .filter((button) => button.getAttribute("data-filter") !== "all")
    .length;

  countBadge.textContent = activeCount > 0 ? `${activeCount} active` : "All stations";
  toggle.setAttribute("aria-label", activeCount > 0 ? `Filters and legend, ${activeCount} active` : "Filters and legend");
}

function updateMapStateFilterSummary() {
  const badge = document.querySelector<HTMLElement>("#map-state-filters");
  if (!badge) return;

  const activeCount = Array.from(document.querySelectorAll<HTMLButtonElement>(".filter-pill[aria-pressed='true']"))
    .filter((button) => button.getAttribute("data-filter") !== "all")
    .length;

  badge.textContent = activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? "" : "s"} active` : "All filters";
}

function updateMapStateCount(count: number) {
  const countBadge = document.querySelector<HTMLElement>("#map-state-count");
  if (!countBadge) return;

  countBadge.textContent = `${count} result${count === 1 ? "" : "s"}`;
}

async function openAddStationOverlay() {
  const { openAddStation } = await import("./addStation");
  openAddStation();
}

/**
 * Debounce utility for input events
 */
function debounce<T>(fn: (arg: T) => Promise<void>, delay: number) {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (arg: T) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(arg), delay);
  };
}

// ============================================================================
// App Initialization
// ============================================================================

function renderAppShell() {
  const app = getElement<HTMLDivElement>("#app");

  app.innerHTML = `
    <div class="app-shell">
      <div
        id="offline-banner"
        role="status"
        aria-live="polite"
        aria-hidden="true"
        style="
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          z-index: 80;
          display: none;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.75rem;
          padding: 0.65rem 1rem;
          border-radius: 999px;
          background: rgba(1, 105, 111, 0.96);
          color: #ffffff;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.01em;
        "
      >
        <span aria-hidden="true">●</span>
        You are offline. Showing cached data where available.
      </div>
      <div id="map" class="map-canvas"></div>
      <div id="map-empty-state" class="map-empty-state" style="display: none;"></div>
      
      <form class="search-bar" role="search" aria-label="Search stations">
        <span class="sidebar-kicker" aria-hidden="true">Find stations</span>
        <span aria-hidden="true">🔎</span>
        <input 
          id="search" 
          type="search" 
          placeholder="Search by city, ZIP, or station name"
          autocomplete="off"
        />
        <button
          id="search-close"
          type="button"
          class="search-bar__close"
          aria-label="Close search overlay"
          aria-hidden="true"
        >
          ✕
        </button>
        <div id="search-dropdown" class="search-dropdown" style="display: none;">
          <ul id="search-results" role="listbox"></ul>
        </div>
      </form>

      <div id="map-state-bar" class="map-state-bar" aria-live="polite" aria-atomic="true">
        <span id="map-state-text" class="map-state-bar__text">Showing: nearby stations</span>
        <span id="map-state-filters" class="map-state-bar__filters">All filters</span>
        <span id="map-state-count" class="map-state-bar__count">0 results</span>
      </div>

      <div class="filter-pills" data-collapsed="true">
        <button class="filter-pills__toggle" type="button" aria-expanded="false">
          <span class="sidebar-kicker" aria-hidden="true">Refine results</span>
          <span class="filter-pills__toggle-label">Filters and legend</span>
          <span id="filter-toggle-count" class="filter-pills__toggle-count">All stations</span>
          <span class="filter-pills__toggle-icon" aria-hidden="true">▾</span>
        </button>
        <div class="filter-pills__body">
          <div class="filter-pills__row" role="group" aria-label="Filter stations">
            <button class="filter-pill active-pill" data-filter="all" aria-pressed="true">
              All
            </button>
            <button class="filter-pill" data-filter="is_free" aria-pressed="false">
              Free
            </button>
            <button class="filter-pill" data-filter="fountain" aria-pressed="false">
              Fountain
            </button>
            <button class="filter-pill" data-filter="bottle_filler" aria-pressed="false">
              Bottle Filler
            </button>
            <button class="filter-pill" data-filter="store_refill" aria-pressed="false">
              Store Refill
            </button>
          </div>
          <div id="map-legend" class="map-legend" data-collapsed="true">
            <button class="map-legend__toggle" type="button" aria-expanded="false">
              <span>Map legend</span>
              <span aria-hidden="true">▾</span>
            </button>
            <div class="map-legend__body">
              <div class="map-legend__item"><span class="map-legend__icon">${getStationTypeIconMarkup("fountain")}</span><span>Fountain</span></div>
              <div class="map-legend__item"><span class="map-legend__icon map-legend__icon--bottle">${getStationTypeIconMarkup("bottle_filler")}</span><span>Bottle filler</span></div>
              <div class="map-legend__item"><span class="map-legend__icon map-legend__icon--store">${getStationTypeIconMarkup("store_refill")}</span><span>Store refill</span></div>
              <div class="map-legend__item"><span class="map-legend__icon map-legend__icon--tap">${getStationTypeIconMarkup("tap")}</span><span>Tap</span></div>
              <div class="map-legend__item"><span class="map-legend__ring"></span><span>Amber ring = unconfirmed 6+ months</span></div>
            </div>
          </div>
        </div>
      </div>

      <button 
        id="search-this-area" 
        class="search-this-area-btn" 
        style="display: none;"
        aria-label="Search this area on the map"
      >
        Search this area
      </button>

      <div class="fab-group">
        <button id="fab-near-me" class="fab" aria-label="Center map on my location" title="Show my location">
          📍
        </button>
        <button id="fab-add" class="fab" aria-label="Add a new station" title="Add station">
          ＋
        </button>
      </div>

      <section class="bottom-sheet" data-state="peek" aria-label="Station details panel">
        <div class="sidebar-kicker sidebar-kicker--sheet" aria-hidden="true">Station details</div>
        <div class="handle" aria-hidden="true"></div>
        <div class="content">
          <article id="station-card" class="station-card">
            <div class="skeleton" style="width: 100%; aspect-ratio: 1 / 1;"></div>
            <div>
              <h2 style="font-size: var(--text-md);">Select a station</h2>
              <p style="color: var(--color-text-muted); margin-top: var(--space-1);">
                Tap a marker to view details and confirmations.
              </p>
              <div class="meta">
                <span class="badge">Pending</span>
                <span class="badge">Unknown Cost</span>
              </div>
            </div>
          </article>
          <div class="confirmation-bar">
            <div class="confirmation-bar__summary">
              <strong>Working status</strong>
              <p style="font-size: var(--text-xs); color: var(--color-text-muted);">No confirmations yet</p>
            </div>
            <div class="confirmation-bar__actions">
              <button class="btn-secondary" data-confirm="false">
                ❌ Not working
              </button>
              <button class="btn-primary" data-confirm="true">
                ✅ Working
              </button>
            </div>
          </div>
        </div>
      </section>

      <nav class="bottom-nav" role="navigation" aria-label="Main navigation">
        <button id="tab-map" class="nav-tab active-tab" aria-current="page">
          🗺️ Map
        </button>
        <button id="tab-search" class="nav-tab">
          🔍 Search
        </button>
        <button id="tab-saved" class="nav-tab">
          ❤️ Saved
        </button>
        <button id="tab-profile" class="nav-tab">
          👤 Profile
        </button>
      </nav>

      <div id="overlay" class="overlay" style="display: none;"></div>
    </div>
  `;
}

function setSearchOverlayActive(active: boolean) {
  const appShell = getElement<HTMLDivElement>(".app-shell");
  const overlay = getElement<HTMLDivElement>("#overlay");
  const searchInput = getElement<HTMLInputElement>("#search");
  const searchDropdown = getElement<HTMLDivElement>("#search-dropdown");
  const searchClose = document.querySelector<HTMLButtonElement>("#search-close");

  appShell.setAttribute("data-search-active", String(active));
  overlay.style.display = active ? "block" : "none";
  overlay.setAttribute("aria-hidden", active ? "false" : "true");

  if (searchClose) {
    searchClose.setAttribute("aria-hidden", active ? "false" : "true");
  }

  if (!active) {
    searchDropdown.style.display = "none";
    searchInput.value = "";
    searchInput.blur();
    return;
  }

  window.requestAnimationFrame(() => {
    searchInput.focus();
    searchInput.select();
  });
}

function setMapEmptyState(count: number) {
  const container = getElement<HTMLDivElement>("#map-empty-state");

  if (count > 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.innerHTML = renderNoStationsEmptyState();
  container.style.display = "block";

  container.querySelector<HTMLButtonElement>("[data-action='open-add-station']")?.addEventListener("click", () => {
    void openAddStationOverlay();
  });
}

function initLegendToggle() {
  const legend = document.querySelector<HTMLElement>("#map-legend");
  if (!legend) return;

  const toggle = legend.querySelector<HTMLButtonElement>(".map-legend__toggle");
  toggle?.addEventListener("click", () => {
    const collapsed = legend.getAttribute("data-collapsed") === "true";
    legend.setAttribute("data-collapsed", String(!collapsed));
    toggle.setAttribute("aria-expanded", String(collapsed));
  });
}

function initFilterToggle() {
  const filters = document.querySelector<HTMLElement>(".filter-pills");
  if (!filters) return;

  const toggle = filters.querySelector<HTMLButtonElement>(".filter-pills__toggle");
  const body = filters.querySelector<HTMLElement>(".filter-pills__body");
  if (!toggle || !body) return;

  toggle.addEventListener("click", () => {
    const collapsed = filters.getAttribute("data-collapsed") === "true";
    filters.setAttribute("data-collapsed", String(!collapsed));
    toggle.setAttribute("aria-expanded", String(collapsed));
  });
}

// ============================================================================
// Station Detail View
// ============================================================================

// ============================================================================
// Station Detail Loader
// ============================================================================

async function handleMapClick(stationId: string) {
  try {
    showStationDetailLoading();
    const station = await fetchStationById(stationId);
    openStationDetail(station);
  } catch (error) {
    console.error("Failed to load station details:", error);
    const sheet = document.querySelector<HTMLElement>(".bottom-sheet");
    const content = sheet?.querySelector<HTMLElement>(".content");

    if (sheet && content) {
      sheet.setAttribute("data-state", "half");
      content.innerHTML = `
        <article class="station-card">
          <div class="empty-state-icon" aria-hidden="true">⚠️</div>
          <div>
            <h2 style="font-size: var(--text-md);">Could not load station details</h2>
            <p style="color: var(--color-text-muted); margin-top: var(--space-1);">
              Please try another marker or tap this marker again.
            </p>
          </div>
        </article>
      `;
    }
  }
}

// ============================================================================
// Bottom Sheet Snap Points
// ============================================================================

class BottomSheetSnap {
  private sheet: HTMLDivElement;
  private startY = 0;
  private startState: "peek" | "half" | "full" = "peek";
  private isDragging = false;

  constructor() {
    this.sheet = getElement<HTMLDivElement>(".bottom-sheet");
    this.initTouchHandlers();
    this.initDragHandleClick();
  }

  private initTouchHandlers() {
    this.sheet.addEventListener("touchstart", (e) => {
      this.startY = e.touches[0]?.clientY ?? 0;
      this.startState = (this.sheet.getAttribute("data-state") as "peek" | "half" | "full") || "peek";
      this.isDragging = true;
    });

    this.sheet.addEventListener("touchmove", (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      // Visual feedback during drag (optional enhancement)
    });

    this.sheet.addEventListener("touchend", (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      const currentY = e.changedTouches[0]?.clientY ?? this.startY;
      const delta = this.startY - currentY; // Negative = swipe up, Positive = swipe down

      // Snap to nearest state based on delta and current state
      if (delta > 50) {
        // Swiped up significantly
        this.snapTo(this.startState === "peek" ? "half" : "full");
      } else if (delta < -50) {
        // Swiped down significantly
        this.snapTo(this.startState === "full" ? "half" : "peek");
      } else {
        // Small swipe or no swipe, stay in current state
        this.snapTo(this.startState);
      }
    });
  }

  private initDragHandleClick() {
    const handle = this.sheet.querySelector(".handle");
    if (!handle) return;

    handle.addEventListener("click", () => {
      const current = (this.sheet.getAttribute("data-state") as "peek" | "half" | "full") || "peek";
      const next = current === "peek" ? "half" : current === "half" ? "full" : "peek";
      this.snapTo(next);
    });
  }

  snapTo(state: "peek" | "half" | "full") {
    this.sheet.setAttribute("data-state", state);
  }
}

// ============================================================================
// Search Bar with Geocoding
// ============================================================================

class SearchBarController {
  private searchForm: HTMLFormElement;
  private input: HTMLInputElement;
  private dropdown: HTMLDivElement;
  private resultsList: HTMLUListElement;
  private map;
  private latestResults: Array<{ place_name: string; center: [number, number] }> = [];
  private latestResultsQuery = "";
  private highlightedIndex = -1;
  private activeGeocodeController: AbortController | null = null;
  private geocodeRequestId = 0;
  private geocodeCache = new Map<string, Array<{ place_name: string; center: [number, number] }>>();

  constructor(mapInstance: MapController) {
    this.searchForm = getElement<HTMLFormElement>(".search-bar");
    this.input = getElement<HTMLInputElement>("#search");
    this.dropdown = getElement<HTMLDivElement>("#search-dropdown");
    this.resultsList = getElement<HTMLUListElement>("#search-results");
    this.map = mapInstance;

    this.initInputHandler();
    this.initSubmitHandler();
    this.initEscapeKey();
    this.initResultClickHandler();
  }

  private initInputHandler() {
    const debouncedSearch = debounce(async (query: string) => {
      const normalizedQuery = query.trim();

      if (normalizedQuery.length < 2) {
        this.latestResults = [];
        this.latestResultsQuery = "";
        this.highlightedIndex = -1;
        this.activeGeocodeController?.abort();
        this.closeDropdown();
        return;
      }

      const cachedResults = this.geocodeCache.get(normalizedQuery);
      if (cachedResults) {
        this.renderResults(cachedResults, normalizedQuery);
        this.openDropdown();
        return;
      }

      this.resultsList.innerHTML = `<li class="search-dropdown__hint">Searching for \"${normalizedQuery}\"...</li>`;
      this.openDropdown();

      this.activeGeocodeController?.abort();
      const controller = new AbortController();
      this.activeGeocodeController = controller;
      const requestId = ++this.geocodeRequestId;

      try {
        const results = await geocodeSearch(normalizedQuery, { signal: controller.signal });

        if (requestId !== this.geocodeRequestId) {
          return;
        }

        this.geocodeCache.set(normalizedQuery, results);
        if (this.geocodeCache.size > 20) {
          const oldestKey = this.geocodeCache.keys().next().value;
          if (oldestKey) {
            this.geocodeCache.delete(oldestKey);
          }
        }

        this.renderResults(results, normalizedQuery);
        this.openDropdown();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        this.latestResults = [];
        this.latestResultsQuery = "";
        this.highlightedIndex = -1;
        console.error("Geocode search failed:", error);
        this.resultsList.innerHTML = `<li class="search-dropdown__hint">${this.getSearchErrorMessage(error)}</li>`;
        this.openDropdown();
      }
    }, 300);

    this.input.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value;
      debouncedSearch(query);
    });
  }

  private renderResults(results: Array<{ place_name: string; center: [number, number] }>, query: string) {
    const limitedResults = results.slice(0, 6);
    this.latestResults = limitedResults;
    this.latestResultsQuery = query;
    this.highlightedIndex = limitedResults.length > 0 ? 0 : -1;

    if (limitedResults.length === 0) {
      this.resultsList.innerHTML = `<li>${renderSearchNoResultsEmptyState(this.input.value)}</li>`;
      return;
    }

    this.resultsList.innerHTML = limitedResults
      .map(
        (result, i) => `
      <li>
        <button 
          type="button"
          class="search-result-item ${i === this.highlightedIndex ? "is-active" : ""}" 
          data-index="${i}" 
          data-lng="${result.center[0]}" 
          data-lat="${result.center[1]}"
          role="option"
          aria-selected="${i === this.highlightedIndex ? "true" : "false"}"
          style="
            padding: var(--space-3);
            background: none;
            border: none;
            text-align: left;
            width: 100%;
            cursor: pointer;
            font-size: var(--text-sm);
            color: var(--color-text);
          "
        >
          📍 ${result.place_name}
        </button>
      </li>
    `,
      )
      .join("");
  }

  private initResultClickHandler() {
    this.resultsList.addEventListener("click", async (e) => {
      e.preventDefault();

      const btn = (e.target as HTMLElement).closest("button");
      if (!btn) return;

      const index = Number.parseInt(btn.getAttribute("data-index") ?? "-1", 10);
      if (Number.isNaN(index) || index < 0) {
        return;
      }

      await this.selectResultByIndex(index);
    });

    this.resultsList.addEventListener("mousemove", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button.search-result-item");
      if (!btn) return;

      const index = Number.parseInt(btn.getAttribute("data-index") ?? "-1", 10);
      if (Number.isNaN(index) || index < 0 || index === this.highlightedIndex) {
        return;
      }

      this.highlightedIndex = index;
      this.renderResults(this.latestResults, this.latestResultsQuery);
      this.openDropdown();
    });
  }

  private async selectResultByIndex(index: number) {
    const selected = this.latestResults[index];
    if (!selected) {
      return;
    }

    const [lng, lat] = selected.center;
    if (!lng || !lat) {
      return;
    }

    await this.handleSearchSelection(lng, lat, selected.place_name);
  }

  private initSubmitHandler() {
    this.searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const query = this.input.value.trim();
      if (query.length < 2) {
        return;
      }

      if (this.latestResults.length > 0 && this.latestResultsQuery === query) {
        const [lng, lat] = this.latestResults[0].center;
        await this.handleSearchSelection(lng, lat, this.latestResults[0].place_name);
        return;
      }

      try {
        const results = await geocodeSearch(query);
        this.renderResults(results, query);

        const firstResult = this.latestResults[0];
        if (!firstResult) {
          this.openDropdown();
          return;
        }

        const [lng, lat] = firstResult.center;
        await this.handleSearchSelection(lng, lat, firstResult.place_name);
      } catch (error) {
        console.error("Geocode search failed:", error);
        this.resultsList.innerHTML = `<li class="search-dropdown__hint">${this.getSearchErrorMessage(error)}</li>`;
        this.openDropdown();
      }
    });
  }

  private getSearchErrorMessage(error: unknown): string {
    if (error instanceof ApiErrorResponse) {
      if (error.status === 429) {
        return "Too many searches right now. Please wait a moment and try again.";
      }

      if (error.status >= 500) {
        return "Search service is temporarily unavailable. Please try again.";
      }

      return "Search request failed. Check your input and try again.";
    }

    return "Could not load search results. Check your connection and API configuration.";
  }

  private initEscapeKey() {
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && this.latestResults.length > 0) {
        e.preventDefault();
        this.highlightedIndex = (this.highlightedIndex + 1 + this.latestResults.length) % this.latestResults.length;
        this.renderResults(this.latestResults, this.latestResultsQuery);
        this.openDropdown();
        return;
      }

      if (e.key === "ArrowUp" && this.latestResults.length > 0) {
        e.preventDefault();
        this.highlightedIndex =
          (this.highlightedIndex - 1 + this.latestResults.length) % this.latestResults.length;
        this.renderResults(this.latestResults, this.latestResultsQuery);
        this.openDropdown();
        return;
      }

      if (e.key === "Enter" && this.latestResults.length > 0 && this.dropdown.style.display === "block") {
        e.preventDefault();
        const targetIndex = this.highlightedIndex >= 0 ? this.highlightedIndex : 0;
        void this.selectResultByIndex(targetIndex);
        return;
      }

      if (e.key === "Escape") {
        this.activeGeocodeController?.abort();
        this.latestResults = [];
        this.latestResultsQuery = "";
        this.highlightedIndex = -1;
        if (getElement<HTMLDivElement>(".app-shell").getAttribute("data-search-active") === "true") {
          setSearchOverlayActive(false);
          return;
        }

        this.input.value = "";
        this.closeDropdown();
      }
    });
  }

  private async handleSearchSelection(lng: number, lat: number, placeLabel: string) {
    this.latestResults = [];
    this.latestResultsQuery = "";
    this.highlightedIndex = -1;
    this.closeDropdown();

    trackPlausible("search_performed");
    this.map.flyTo(lng, lat, 14);
    showUserSearchStatus(`Showing results near ${placeLabel}`);
    await this.loadStationsAtLocation(lng, lat);
  }

  private openDropdown() {
    this.dropdown.style.display = "block";
  }

  private closeDropdown() {
    this.dropdown.style.display = "none";
  }

  private async loadStationsAtLocation(lng: number, lat: number) {
    try {
      const geojson = await fetchStationsWithNearbyFallback(lat, lng);
      this.map.loadStations(geojson);
      await openNearestStationIfAvailable(geojson);

      if (geojson.features.length === 0) {
        showNoNearbyStationsMessage();
      }
    } catch (error) {
      console.error("Failed to load stations:", error);
    }
  }
}

// ============================================================================
// Filter Pills Controller
// ============================================================================

class FilterPillsController {
  private pills: HTMLButtonElement[];
  private map;
  private currentType: string | undefined;
  private currentIsFree: boolean | undefined;

  constructor(mapInstance: MapController) {
    this.pills = Array.from(getElement(".filter-pills").querySelectorAll(".filter-pill"));
    this.map = mapInstance;
    this.initPillHandlers();
  }

  private initPillHandlers() {
    this.pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const filter = pill.getAttribute("data-filter");
        if (!filter) return;

        if (filter === "all") {
          // Reset all filters
          this.currentType = undefined;
          this.currentIsFree = undefined;
          this.pills.forEach((p) => p.classList.remove("active-pill"));
          pill.classList.add("active-pill");
        } else if (filter === "is_free") {
          // Toggle free filter
          this.currentIsFree = this.currentIsFree === true ? undefined : true;
          pill.classList.toggle("active-pill");
        } else {
          // Type filters (fountain, bottle_filler, store_refill)
          const wasActive = pill.classList.contains("active-pill");

          if (wasActive) {
            this.currentType = undefined;
            this.pills.forEach((p) => p.classList.remove("active-pill"));
            this.pills[0].classList.add("active-pill");
          } else {
            this.currentType = filter;
            this.pills.forEach((p) => p.classList.remove("active-pill"));
            pill.classList.add("active-pill");
          }
        }

        // Apply filter
        this.map.setFilter({
          type: this.currentType,
          is_free: this.currentIsFree,
        });

        updateFilterToggleSummary();
        updateMapStateFilterSummary();
      });
    });

    updateFilterToggleSummary();
    updateMapStateFilterSummary();
  }
}

// ============================================================================
// Search This Area Button
// ============================================================================

class SearchThisAreaController {
  private button: HTMLButtonElement;
  private map;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(mapInstance: MapController) {
    this.button = getElement<HTMLButtonElement>("#search-this-area");
    this.map = mapInstance;
    this.initMapMoveHandler();
    this.initButtonClick();
  }

  private initMapMoveHandler() {
    this.map.onMapMove(() => {
      if (this.revealTimer) {
        clearTimeout(this.revealTimer);
      }

      // Show button when user manually moves the map
      if (!isSearchingThisArea && lastGeolocationResult) {
        const center = this.map.getCurrentCenter();
        const moved = Math.abs(center.lat - lastGeolocationResult.lat) > 0.01 ||
                       Math.abs(center.lng - lastGeolocationResult.lng) > 0.01;

        this.revealTimer = setTimeout(() => {
          this.button.style.display = moved ? "block" : "none";
        }, 1500);
      }
    });
  }

  private initButtonClick() {
    this.button.addEventListener("click", async () => {
      const center = this.map.getCurrentCenter();
      try {
        isSearchingThisArea = true;
        const geojson = await fetchStationsWithNearbyFallback(center.lat, center.lng);
        this.map.loadStations(geojson);
        await openNearestStationIfAvailable(geojson);
        if (geojson.features.length === 0) {
          showNoNearbyStationsMessage();
        }
        showUserSearchStatus("Search applied to this map area");
        this.button.style.display = "none";
        isSearchingThisArea = false;
      } catch (error) {
        console.error("Failed to search this area:", error);
        isSearchingThisArea = false;
      }
    });
  }
}

// ============================================================================
// FAB Buttons
// ============================================================================

function initFabButtons(map: MapController) {
  const fabNearMe = getElement<HTMLButtonElement>("#fab-near-me");
  const fabAdd = getElement<HTMLButtonElement>("#fab-add");

  // Near Me button
  fabNearMe.addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        lastGeolocationResult = { lat: latitude, lng: longitude };
        syncSavedStationsGeolocation(latitude, longitude);

        // Update user location for stationDetail distance calculations
        updateUserLocation(latitude, longitude);

        map.flyTo(longitude, latitude, 14);
        map.showUserLocation(longitude, latitude);
        loadStationsAtLocation(longitude, latitude);
      },
      () => {
        console.error("Geolocation denied");
      },
    );
  });

  fabAdd.addEventListener("click", () => {
    void openAddStationOverlay();
  });
}

// ============================================================================
// Bottom Nav Tabs
// ============================================================================

function initBottomNav() {
  const tabs = {
    map: getElement<HTMLButtonElement>("#tab-map"),
    search: getElement<HTMLButtonElement>("#tab-search"),
    saved: getElement<HTMLButtonElement>("#tab-saved"),
    profile: getElement<HTMLButtonElement>("#tab-profile"),
  };

  const overlay = getElement<HTMLDivElement>("#overlay");
  const navTabs = Array.from(getElement(".bottom-nav").querySelectorAll(".nav-tab"));
  const searchClose = document.querySelector<HTMLButtonElement>("#search-close");

  const setActiveTab = (activeTab: HTMLButtonElement) => {
    navTabs.forEach((tab) => tab.classList.remove("active-tab"));
    activeTab.classList.add("active-tab");
  };

  const closeSearchMode = () => {
    setSearchOverlayActive(false);
    setActiveTab(tabs.map);
    tabs.map.setAttribute("aria-current", "page");
    tabs.search.removeAttribute("aria-current");
  };

  tabs.map.addEventListener("click", () => {
    closeSearchMode();
    overlay.style.display = "none";
  });

  tabs.search.addEventListener("click", () => {
    overlay.style.display = "block";
    setActiveTab(tabs.search);
    tabs.search.setAttribute("aria-current", "page");
    tabs.map.removeAttribute("aria-current");
    setSearchOverlayActive(true);
  });

  tabs.saved.addEventListener("click", () => {
    setSearchOverlayActive(false);
    overlay.style.display = "block";
    setActiveTab(tabs.saved);
    tabs.saved.setAttribute("aria-current", "page");
    tabs.map.removeAttribute("aria-current");
    tabs.search.removeAttribute("aria-current");
    void openSavedStationsOverlay();
  });

  tabs.profile.addEventListener("click", () => {
    setSearchOverlayActive(false);
    overlay.style.display = "block";
    setActiveTab(tabs.profile);
    tabs.profile.setAttribute("aria-current", "page");
    tabs.map.removeAttribute("aria-current");
    tabs.search.removeAttribute("aria-current");
    void openProfileOverlay();
  });

  searchClose?.addEventListener("click", closeSearchMode);
  overlay.addEventListener("click", () => {
    if (getElement<HTMLDivElement>(".app-shell").getAttribute("data-search-active") === "true") {
      closeSearchMode();
    }
  });
}

// ============================================================================
// Geolocation & Initial Load
// ============================================================================

// Global reference to map instance
let mapInstance: MapController | null = null;

async function loadStationsAtLocation(lng: number, lat: number) {
  if (!mapInstance) return;
  try {
    isSearchingThisArea = true;
    const geojson = await fetchStationsWithNearbyFallback(lat, lng);
    mapInstance.loadStations(geojson);
    trackFirstStationsLoad(geojson.features.length);
    await openNearestStationIfAvailable(geojson);
    if (geojson.features.length === 0) {
      showNoNearbyStationsMessage();
    }
    isSearchingThisArea = false;
  } catch (error) {
    console.error("Failed to load stations:", error);
    isSearchingThisArea = false;
  }
}

function requestGeolocation(map: MapController) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      lastGeolocationResult = { lat: latitude, lng: longitude };
      syncSavedStationsGeolocation(latitude, longitude);

      // Update user location for stationDetail distance calculations
      updateUserLocation(latitude, longitude);

      // Fly to user location
      map.flyTo(longitude, latitude, 14);
      map.showUserLocation(longitude, latitude);

      // Load stations at user location
      (async () => {
        try {
          const geojson = await fetchStationsWithNearbyFallback(latitude, longitude);
          map.loadStations(geojson);
          trackFirstStationsLoad(geojson.features.length);
          await openNearestStationIfAvailable(geojson);
          if (geojson.features.length === 0) {
            showNoNearbyStationsMessage();
          }
        } catch (error) {
          console.error("Failed to load stations:", error);
        }
      })();
    },
    () => {
      // Geolocation denied or failed - focus search bar
      const searchInput = getElement<HTMLInputElement>("#search");
      searchInput.focus();
      searchInput.placeholder = "Enter your location to find stations";
    },
  );
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  initAnalytics();
  startTiming("boot_to_shell_ready");

  // Render app shell
  renderAppShell();
  trackTiming("perf_shell_ready", "boot_to_shell_ready");
  initLegendToggle();
  initFilterToggle();
  initConnectivityBanner();
  registerServiceWorker();

  // Initialize authentication (restore session if present)
  initializeAuth();

  // Initialize bottom nav tabs early so non-map overlays remain responsive.
  initBottomNav();

  // Wait for idle or first interaction before loading the heavy map bundle.
  startTiming("shell_to_map_bundle_ready");
  await waitForMapBootstrapSignal();

  // Initialize map
  const { initMap } = await import("./map");
  trackTiming("perf_map_bundle_loaded", "shell_to_map_bundle_ready");
  startTiming("map_bootstrap_ready");
  mapInstance = initMap("map");
  syncSavedStationsMapInstance(mapInstance);
  mapInstance.onVisibleStationsChange((count) => {
    setMapEmptyState(count);
    updateMapStateCount(count);
  });
  trackTiming("perf_map_ready", "map_bootstrap_ready");
  startTiming("map_init_to_first_stations");

  // Load saved stations for authenticated user
  loadSavedStations();

  // Set up geolocation on load
  requestGeolocation(mapInstance);

  // Initialize all controllers
  new SearchBarController(mapInstance);
  new FilterPillsController(mapInstance);
  new SearchThisAreaController(mapInstance);
  new BottomSheetSnap();

  // Initialize FAB buttons
  initFabButtons(mapInstance);

  // Connect map station click to detail view
  mapInstance.onStationClick((stationId) => {
    const searchThisAreaButton = document.querySelector<HTMLButtonElement>("#search-this-area");
    if (searchThisAreaButton) {
      searchThisAreaButton.style.display = "none";
    }

    handleMapClick(stationId);
  });
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
