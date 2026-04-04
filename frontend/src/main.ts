import { initMap } from "./map";
import { fetchStations, geocodeSearch, fetchStationById } from "./api";
import { openStationDetail, updateUserLocation } from "./stationDetail";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

// ============================================================================
// UI State
// ============================================================================

let isSearchingThisArea = false;
let lastGeolocationResult: { lat: number; lng: number } | null = null;

// ============================================================================
// DOM Utilities
// ============================================================================

function getElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
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
      <div id="map" class="map-canvas"></div>
      
      <form class="search-bar" role="search" aria-label="Search stations">
        <span aria-hidden="true">🔎</span>
        <input 
          id="search" 
          type="search" 
          placeholder="Search by city, ZIP, or station name"
          autocomplete="off"
        />
        <div id="search-dropdown" class="search-dropdown" style="display: none;">
          <ul id="search-results" role="listbox"></ul>
        </div>
      </form>

      <div class="filter-pills" role="toolbar" aria-label="Filters">
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
            <div>
              <strong>Working status</strong>
              <p style="font-size: var(--text-xs); color: var(--color-text-muted);">No confirmations yet</p>
            </div>
            <div style="display: flex; gap: var(--space-2);">
              <button class="btn-secondary" style="flex: 1;" data-confirm="false">
                ❌ Not working
              </button>
              <button class="btn-primary" style="flex: 1;" data-confirm="true">
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

// ============================================================================
// Station Detail View
// ============================================================================

// ============================================================================
// Station Detail Loader
// ============================================================================

async function handleMapClick(stationId: string) {
  try {
    const station = await fetchStationById(stationId);
    openStationDetail(station);
  } catch (error) {
    console.error("Failed to load station details:", error);
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
  private input: HTMLInputElement;
  private dropdown: HTMLDivElement;
  private resultsList: HTMLUListElement;
  private map;

  constructor(mapInstance: ReturnType<typeof initMap>) {
    this.input = getElement<HTMLInputElement>("#search");
    this.dropdown = getElement<HTMLDivElement>("#search-dropdown");
    this.resultsList = getElement<HTMLUListElement>("#search-results");
    this.map = mapInstance;

    this.initInputHandler();
    this.initEscapeKey();
    this.initResultClickHandler();
  }

  private initInputHandler() {
    const debouncedSearch = debounce(async (query: string) => {
      if (query.length < 2) {
        this.dropdown.style.display = "none";
        return;
      }

      try {
        const results = await geocodeSearch(query);
        this.renderResults(results);
        this.dropdown.style.display = results.length > 0 ? "block" : "none";
      } catch (error) {
        console.error("Geocode search failed:", error);
        this.dropdown.style.display = "none";
      }
    }, 300);

    this.input.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value;
      debouncedSearch(query);
    });
  }

  private renderResults(results: Array<{ place_name: string; center: [number, number] }>) {
    this.resultsList.innerHTML = results
      .map(
        (result, i) => `
      <li>
        <button 
          class="search-result-item" 
          data-index="${i}" 
          data-lng="${result.center[0]}" 
          data-lat="${result.center[1]}"
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
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn) return;

      const lng = parseFloat(btn.getAttribute("data-lng") ?? "0");
      const lat = parseFloat(btn.getAttribute("data-lat") ?? "0");

      if (!lng || !lat) return;

      // Close dropdown and clear input
      this.input.value = "";
      this.dropdown.style.display = "none";

      // Fly to location and load stations
      this.map.flyTo(lng, lat, 14);
      await this.loadStationsAtLocation(lng, lat);
    });
  }

  private initEscapeKey() {
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.input.value = "";
        this.dropdown.style.display = "none";
      }
    });
  }

  private async loadStationsAtLocation(lng: number, lat: number) {
    try {
      const geojson = await fetchStations({ lng, lat });
      this.map.loadStations(geojson);
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

  constructor(mapInstance: ReturnType<typeof initMap>) {
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
      });
    });
  }
}

// ============================================================================
// Search This Area Button
// ============================================================================

class SearchThisAreaController {
  private button: HTMLButtonElement;
  private map;

  constructor(mapInstance: ReturnType<typeof initMap>) {
    this.button = getElement<HTMLButtonElement>("#search-this-area");
    this.map = mapInstance;
    this.initMapMoveHandler();
    this.initButtonClick();
  }

  private initMapMoveHandler() {
    this.map.onMapMove(() => {
      // Show button when user manually moves the map
      if (!isSearchingThisArea && lastGeolocationResult) {
        const center = this.map.getCurrentCenter();
        const moved = Math.abs(center.lat - lastGeolocationResult.lat) > 0.01 ||
                       Math.abs(center.lng - lastGeolocationResult.lng) > 0.01;
        
        this.button.style.display = moved ? "block" : "none";
      }
    });
  }

  private initButtonClick() {
    this.button.addEventListener("click", async () => {
      const center = this.map.getCurrentCenter();
      try {
        const geojson = await fetchStations({ lat: center.lat, lng: center.lng });
        this.map.loadStations(geojson);
        this.button.style.display = "none";
        isSearchingThisArea = false;
      } catch (error) {
        console.error("Failed to search this area:", error);
      }
    });
  }
}

// ============================================================================
// FAB Buttons
// ============================================================================

function initFabButtons(map: ReturnType<typeof initMap>) {
  const fabNearMe = getElement<HTMLButtonElement>("#fab-near-me");
  const fabAdd = getElement<HTMLButtonElement>("#fab-add");

  // Near Me button
  fabNearMe.addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        lastGeolocationResult = { lat: latitude, lng: longitude };

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

  // Add Station button (placeholder)
  fabAdd.addEventListener("click", () => {
    console.log("Add station feature coming in Phase 4");
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

  tabs.map.addEventListener("click", () => {
    overlay.style.display = "none";
    navTabs.forEach((t) => t.classList.remove("active-tab"));
    tabs.map.classList.add("active-tab");
  });

  tabs.search.addEventListener("click", () => {
    overlay.style.display = "block";
    navTabs.forEach((t) => t.classList.remove("active-tab"));
    tabs.search.classList.add("active-tab");
    // TODO: Render full-screen search overlay
  });

  tabs.saved.addEventListener("click", () => {
    overlay.style.display = "block";
    navTabs.forEach((t) => t.classList.remove("active-tab"));
    tabs.saved.classList.add("active-tab");
    // TODO: Render saved stations view
  });

  tabs.profile.addEventListener("click", () => {
    overlay.style.display = "block";
    navTabs.forEach((t) => t.classList.remove("active-tab"));
    tabs.profile.classList.add("active-tab");
    // TODO: Render profile view
  });
}

// ============================================================================
// Geolocation & Initial Load
// ============================================================================

// Global reference to map instance
let mapInstance: ReturnType<typeof initMap> | null = null;

async function loadStationsAtLocation(lng: number, lat: number) {
  if (!mapInstance) return;
  try {
    const geojson = await fetchStations({ lat, lng });
    mapInstance.loadStations(geojson);
  } catch (error) {
    console.error("Failed to load stations:", error);
  }
}

function requestGeolocation(map: ReturnType<typeof initMap>) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      lastGeolocationResult = { lat: latitude, lng: longitude };

      // Update user location for stationDetail distance calculations
      updateUserLocation(latitude, longitude);

      // Fly to user location
      map.flyTo(longitude, latitude, 14);
      map.showUserLocation(longitude, latitude);

      // Load stations at user location
      (async () => {
        try {
          const geojson = await fetchStations({ lat: latitude, lng: longitude });
          map.loadStations(geojson);
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

function main() {
  // Render app shell
  renderAppShell();

  // Initialize map
  mapInstance = initMap("map");

  // Set up geolocation on load
  requestGeolocation(mapInstance);

  // Initialize all controllers
  new SearchBarController(mapInstance);
  new FilterPillsController(mapInstance);
  new SearchThisAreaController(mapInstance);
  new BottomSheetSnap();

  // Initialize FAB buttons
  initFabButtons(mapInstance);

  // Initialize bottom nav tabs
  initBottomNav();

  // Connect map station click to detail view
  mapInstance.onStationClick((stationId) => {
    handleMapClick(stationId);
  });
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
