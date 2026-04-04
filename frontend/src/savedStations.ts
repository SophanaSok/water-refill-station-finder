import { fetchSavedStations, unsaveStation } from "./api.js";
import type { Station } from "./api.js";
import { isAuthenticated } from "./auth.js";
import { openAuthModal } from "./authModal.js";
import { openStationDetail } from "./stationDetail.js";

let savedSheetOpen = false;
let savedSheetContainer: HTMLDivElement | null = null;

// Reference to the main map instance (set from main.ts) - reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _mapInstance: any = null;
void _mapInstance;

export function setMapInstance(map: any): void {
  _mapInstance = map;
}

// Inject styles for saved stations view
function injectSavedStationsCSS() {
  if (document.getElementById("saved-stations-styles")) return;

  const style = document.createElement("style");
  style.id = "saved-stations-styles";
  style.textContent = `
    .saved-sheet-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      z-index: 999;
      animation: fadeIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .saved-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--color-surface);
      border-radius: 16px 16px 0 0;
      padding: 20px;
      max-height: 90vh;
      overflow-y: auto;
      animation: slideUp 0.3s ease-in-out;
    }

    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }

    @media (min-width: 768px) {
      .saved-sheet {
        position: fixed;
        max-width: 600px;
        left: 50%;
        transform: translateX(-50%) translateY(50%);
        border-radius: 16px;
        bottom: 50%;
        top: auto;
      }

      .saved-sheet-overlay {
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }

    .saved-sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .saved-sheet-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--color-text);
      padding: 0;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .saved-sheet-content {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .saved-station-item {
      padding: 12px 0;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      cursor: pointer;
      transition: background 0.2s ease-in-out;
    }

    .saved-station-item:last-child {
      border-bottom: none;
    }

    .saved-station-item:active {
      background: rgba(0, 0, 0, 0.02);
    }

    .saved-station-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .saved-station-name {
      font-size: var(--font-size-body);
      font-weight: 600;
      color: var(--color-text);
    }

    .saved-station-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: var(--font-size-caption);
      color: var(--color-text-secondary);
    }

    .saved-station-badge {
      display: inline-block;
      padding: 2px 8px;
      background: var(--color-primary);
      color: var(--color-surface);
      border-radius: 4px;
      font-weight: 500;
      font-size: 0.75rem;
    }

    .saved-station-distance {
      color: var(--color-text-secondary);
      font-size: var(--font-size-caption);
    }

    .saved-station-unsave {
      font-size: 20px;
      cursor: pointer;
      padding: 8px;
      background: none;
      border: none;
      color: var(--color-primary);
      transition: transform 0.2s ease-in-out;
    }

    .saved-station-unsave:active {
      transform: scale(1.2);
    }

    .saved-station-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 40px 20px;
      text-align: center;
    }

    .saved-station-empty-icon {
      font-size: 48px;
      opacity: 0.3;
    }

    .saved-station-empty-text {
      font-size: var(--font-size-body);
      color: var(--color-text-secondary);
    }

    .saved-station-button {
      padding: 12px 16px;
      border: none;
      border-radius: 8px;
      font-size: var(--font-size-body-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
      background: var(--color-primary);
      color: var(--color-surface);
      width: 100%;
    }

    .saved-station-button:active {
      opacity: 0.9;
    }

    .saved-station-skeleton {
      padding: 12px 0;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      gap: 12px;
    }

    .skeleton {
      background: linear-gradient(
        90deg,
        var(--color-border) 25%,
        rgba(0, 0, 0, 0.05) 50%,
        var(--color-border) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .saved-station-skeleton-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .saved-station-skeleton-name {
      width: 60%;
      height: 16px;
      border-radius: 4px;
      background: var(--color-border);
    }

    .saved-station-skeleton-meta {
      width: 40%;
      height: 12px;
      border-radius: 4px;
      background: var(--color-border);
    }
  `;
  document.head.appendChild(style);
}

function buildSavedStationsHTML(stations: Station[]): string {
  if (stations.length === 0) {
    return `
      <div class="saved-sheet-overlay" data-dismiss="true">
        <div class="saved-sheet">
          <div class="saved-sheet-header">
            <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Saved Stations</h2>
            <button class="saved-sheet-close" data-action="close">✕</button>
          </div>

          <div class="saved-station-empty">
            <div class="saved-station-empty-icon">💧</div>
            <div class="saved-station-empty-text">
              No saved stations yet. Tap ⭐ on any station to save it.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const stationItems = stations
    .map(
      (station) => `
    <div class="saved-station-item" data-station-id="${station.id}">
      <div class="saved-station-info">
        <div class="saved-station-name">${escapeHtml(station.name)}</div>
        <div class="saved-station-meta">
          ${station.type ? `<span class="saved-station-badge">${escapeHtml(station.type)}</span>` : ""}
          <span class="saved-station-distance">${escapeHtml(station.city || "")}${station.state ? ", " + escapeHtml(station.state) : ""}</span>
        </div>
      </div>
      <button class="saved-station-unsave" data-station-id="${station.id}" data-action="unsave">⭐</button>
    </div>
  `,
    )
    .join("");

  return `
    <div class="saved-sheet-overlay" data-dismiss="true">
      <div class="saved-sheet">
        <div class="saved-sheet-header">
          <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Saved Stations (${stations.length})</h2>
          <button class="saved-sheet-close" data-action="close">✕</button>
        </div>

        <div class="saved-sheet-content">
          ${stationItems}
        </div>
      </div>
    </div>
  `;
}

function buildLoadingHTML(): string {
  return `
    <div class="saved-sheet-overlay" data-dismiss="true">
      <div class="saved-sheet">
        <div class="saved-sheet-header">
          <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Saved Stations</h2>
          <button class="saved-sheet-close" data-action="close">✕</button>
        </div>

        <div class="saved-sheet-content">
          ${Array.from({ length: 3 })
            .map(
              () => `
            <div class="saved-station-skeleton">
              <div class="saved-station-skeleton-info">
                <div class="saved-station-skeleton-name skeleton"></div>
                <div class="saved-station-skeleton-meta skeleton"></div>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function openSavedStationsSheet(): void {
  injectSavedStationsCSS();

  // Remove existing sheet if present
  if (savedSheetContainer) {
    savedSheetContainer.remove();
  }

  const isAuth = isAuthenticated();

  if (!isAuth) {
    // Not authenticated - show sign in prompt
    savedSheetContainer = document.createElement("div");
    savedSheetContainer.innerHTML = `
      <div class="saved-sheet-overlay" data-dismiss="true">
        <div class="saved-sheet">
          <div class="saved-sheet-header">
            <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Saved Stations</h2>
            <button class="saved-sheet-close" data-action="close">✕</button>
          </div>

          <div class="saved-station-empty">
            <div class="saved-station-empty-icon">💧</div>
            <div class="saved-station-empty-text">
              Sign in to save your favorite stations and access them across devices.
            </div>
            <button class="saved-station-button" data-action="signin">
              Sign In / Sign Up
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(savedSheetContainer);
    savedSheetOpen = true;

    attachSavedStationsEventListeners();
    return;
  }

  // Show loading state
  savedSheetContainer = document.createElement("div");
  savedSheetContainer.innerHTML = buildLoadingHTML();
  document.body.appendChild(savedSheetContainer);
  savedSheetOpen = true;

  attachSavedStationsEventListeners();

  // Fetch saved stations
  let userLat = lastGeolocation?.lat;
  let userLng = lastGeolocation?.lng;

  fetchSavedStations({ lat: userLat, lng: userLng })
    .then((stations) => {
      closeSavedStationsSheet();
      
      // Rebuild with actual data
      savedSheetContainer = document.createElement("div");
      savedSheetContainer.innerHTML = buildSavedStationsHTML(stations);
      document.body.appendChild(savedSheetContainer);
      savedSheetOpen = true;

      attachSavedStationsEventListeners();
    })
    .catch((error) => {
      console.error("Failed to fetch saved stations:", error);
      closeSavedStationsSheet();
      
      // Show error state with retry
      savedSheetContainer = document.createElement("div");
      savedSheetContainer.innerHTML = `
        <div class="saved-sheet-overlay" data-dismiss="true">
          <div class="saved-sheet">
            <div class="saved-sheet-header">
              <h2 style="margin: 0; font-size: var(--font-size-heading-sm);">Saved Stations</h2>
              <button class="saved-sheet-close" data-action="close">✕</button>
            </div>

            <div class="saved-station-empty">
              <div class="saved-station-empty-text">
                Failed to load saved stations. Please try again.
              </div>
              <button class="saved-station-button" data-action="retry">
                Retry
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(savedSheetContainer);
      savedSheetOpen = true;

      const retryBtn = savedSheetContainer.querySelector('[data-action="retry"]');
      retryBtn?.addEventListener("click", openSavedStationsSheet);

      attachSavedStationsEventListeners();
    });
}

function attachSavedStationsEventListeners(): void {
  const overlay = savedSheetContainer?.querySelector(".saved-sheet-overlay");
  const closeBtn = savedSheetContainer?.querySelector('[data-action="close"]');
  const signinBtn = savedSheetContainer?.querySelector('[data-action="signin"]');

  if (closeBtn) {
    closeBtn.addEventListener("click", closeSavedStationsSheet);
  }

  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).getAttribute("data-dismiss") === "true") {
        closeSavedStationsSheet();
      }
    });
  }

  if (signinBtn) {
    signinBtn.addEventListener("click", () => {
      closeSavedStationsSheet();
      openAuthModal();
    });
  }

  // Handle station item clicks
  const stationItems = savedSheetContainer?.querySelectorAll(".saved-station-item");
  stationItems?.forEach((item) => {
    item.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      // Don't navigate if clicking the unsave button
      if (target.closest('[data-action="unsave"]')) {
        return;
      }

      const stationId = item.getAttribute("data-station-id");
      if (!stationId) return;

      // Close the saved stations sheet
      closeSavedStationsSheet();

      // Fetch the station details and open it
      try {
        const { fetchStationById } = await import("./api.js");
        const station = await fetchStationById(stationId);
        openStationDetail(station);
      } catch (error) {
        console.error("Failed to fetch station details:", error);
      }
    });
  });

  // Handle unsave button clicks
  const unsaveButtons = savedSheetContainer?.querySelectorAll('[data-action="unsave"]');
  unsaveButtons?.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const stationId = (btn as HTMLElement).getAttribute("data-station-id");
      if (!stationId) return;

      try {
        await unsaveStation(stationId);
        
        // Remove the item from the list
        const item = btn.closest(".saved-station-item");
        item?.remove();

        // Check if list is now empty
        const items = savedSheetContainer?.querySelectorAll(".saved-station-item");
        if (!items || items.length === 0) {
          // Show empty state
          const content = savedSheetContainer?.querySelector(".saved-sheet-content");
          if (content) {
            content.innerHTML = `
              <div class="saved-station-empty">
                <div class="saved-station-empty-icon">💧</div>
                <div class="saved-station-empty-text">
                  No saved stations yet. Tap ⭐ on any station to save it.
                </div>
              </div>
            `;
          }
        }
      } catch (error) {
        console.error("Failed to unsave station:", error);
      }
    });
  });
}

export function closeSavedStationsSheet(): void {
  if (savedSheetContainer) {
    savedSheetContainer.remove();
    savedSheetContainer = null;
    savedSheetOpen = false;
  }
}

export function isSavedStationsSheetOpen(): boolean {
  return savedSheetOpen;
}

// Reference to last known geolocation (set from main.ts)
let lastGeolocation: { lat: number; lng: number } | null = null;

export function setLastGeolocation(lat: number, lng: number): void {
  lastGeolocation = { lat, lng };
}
