import { confirmStation, flagStation } from "./api";
import type { StationDetail } from "./api";

// ============================================================================
// Module State
// ============================================================================

let currentStation: StationDetail | null = null;
let userLocation: { lat: number; lng: number } | null = null;
let savedStationIds: Set<string> = new Set(
  JSON.parse(localStorage.getItem("savedStationIds") ?? "[]") as string[],
);
let hasConfirmedThisSession = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Open the station detail sheet and populate with station data
 */
export function openStationDetail(station: StationDetail): void {
  currentStation = station;
  hasConfirmedThisSession = false;

  const sheet = getBottomSheet();
  const contentDiv = sheet.querySelector(".content");
  if (!contentDiv) return;

  // Build the station detail HTML
  const html = buildStationDetailHTML(station);
  contentDiv.innerHTML = html;

  // Attach event listeners
  attachEventListeners(sheet);

  // Animate open
  sheet.setAttribute("data-state", "half");
  sheet.scrollTop = 0;
}

/**
 * Close the station detail sheet
 */
export function closeStationDetail(): void {
  const sheet = getBottomSheet();
  sheet.setAttribute("data-state", "peek");
  currentStation = null;
}

/**
 * Update user location for distance calculations
 */
export function updateUserLocation(lat: number, lng: number): void {
  userLocation = { lat, lng };
}

/**
 * Calculate distance in miles using Haversine formula
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  if (distance < 0.1) return "< 0.1 mi";
  return `${distance.toFixed(1)} mi`;
}

// ============================================================================
// Private Utilities
// ============================================================================

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function getBottomSheet(): HTMLElement {
  const sheet = document.querySelector<HTMLElement>(".bottom-sheet");
  if (!sheet) throw new Error("Bottom sheet not found");
  return sheet;
}

// ============================================================================
// HTML Builder
// ============================================================================

function buildStationDetailHTML(station: StationDetail): string {
  const distance =
    userLocation && station.latitude && station.longitude
      ? calculateDistance(userLocation.lat, userLocation.lng, station.latitude, station.longitude)
      : null;

  const isSaved = savedStationIds.has(station.id);
  const starIcon = isSaved ? "⭐" : "☆";

  const hasPhotoUrl = station.photo_url !== null && station.photo_url !== undefined;
  const photoHtml = hasPhotoUrl
    ? `<img id="station-photo" src="${escapeHtml(station.photo_url ?? "")}" alt="${escapeHtml(station.name)}" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-md);" />`
    : `<div class="station-photo-placeholder" style="width: 100%; aspect-ratio: 1; background: color-mix(in srgb, var(--color-primary) 12%, transparent 88%); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; font-size: 3rem;">
         ${getStationTypeIcon(station.type)}
       </div>`;

  const freshnessHtml = getFreshnessHTML(station);
  const typeLabel = station.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const costBadge = station.is_free ? "Free" : "Paid";
  const verifiedBadge = station.is_verified ? `<span class="badge">✓ Verified</span>` : "";
  const distanceBadge = distance ? `<span class="badge">${distance}</span>` : "";

  return `
    <article id="station-detail" class="station-detail" style="display: grid; gap: var(--space-4);">
      
      <!-- Photo Section -->
      <div id="photo-section" style="width: 100%;">
        <div class="skeleton" style="width: 100%; aspect-ratio: 1; display: none;" id="photo-skeleton"></div>
        <div id="photo-container">
          ${photoHtml}
        </div>
      </div>

      <!-- Header -->
      <div style="display: grid; gap: var(--space-2);">
        <div style="display: flex; align-items: start; gap: var(--space-2); justify-content: space-between;">
          <h2 style="font-size: var(--text-lg); margin: 0; flex: 1;">${escapeHtml(station.name)}</h2>
          ${verifiedBadge}
        </div>
      </div>

      <!-- Meta Info -->
      <div style="display: flex; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-sm);">
        <span class="badge">${typeLabel}</span>
        <span class="badge">${costBadge}</span>
        ${distanceBadge}
        <span class="badge">${escapeHtml(station.city)}, ${escapeHtml(station.state)}</span>
      </div>

      <!-- Address -->
      <p style="margin: 0; font-size: var(--text-sm); color: var(--color-text-muted);">
        ${escapeHtml(station.address)}
      </p>

      <!-- Freshness Indicator -->
      ${freshnessHtml}

      <!-- Confirmation Bar -->
      <div class="confirmation-bar" style="display: flex; gap: var(--space-2); margin-top: var(--space-2);">
        <button 
          id="confirm-working"
          class="btn-primary" 
          style="flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-1);" 
          data-station-id="${station.id}"
          data-confirm="true"
          ${hasConfirmedThisSession ? 'disabled' : ''}
        >
          👍 <span id="working-count">${station.working_count}</span>
        </button>
        <button 
          id="confirm-not-working"
          class="btn-secondary" 
          style="flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-1);"
          data-station-id="${station.id}"
          data-confirm="false"
          ${hasConfirmedThisSession ? 'disabled' : ''}
        >
          👎 <span id="not-working-count">${station.not_working_count}</span>
        </button>
      </div>

      <!-- Action Row -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2);">
        <button 
          id="save-station-btn" 
          class="btn-secondary" 
          style="display: flex; align-items: center; justify-content: center; gap: var(--space-1);"
          data-station-id="${station.id}"
        >
          <span id="save-icon">${starIcon}</span>
          ${isSaved ? "Saved" : "Save"}
        </button>
        <button 
          id="directions-btn" 
          class="btn-secondary" 
          style="display: flex; align-items: center; justify-content: center; gap: var(--space-1);"
          data-lat="${station.latitude}"
          data-lng="${station.longitude}"
        >
          🗺 Directions
        </button>
      </div>

      <!-- Secondary Actions -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); border-top: 1px solid var(--color-border); padding-top: var(--space-3); margin-top: var(--space-3);">
        <button id="add-photo-btn" class="btn-ghost" style="display: flex; align-items: center; justify-content: center; gap: var(--space-1); color: var(--color-text-muted);">
          📷 Photo
        </button>
        <button id="report-issue-btn" class="btn-ghost" style="display: flex; align-items: center; justify-content: center; gap: var(--space-1); color: var(--color-text-muted);">
          🚩 Report
        </button>
      </div>

      <!-- Flag Form (hidden by default) -->
      <form id="flag-form" style="display: none; border-top: 1px solid var(--color-border); padding-top: var(--space-3); margin-top: var(--space-2); animation: slideDown 0.2s ease-out;" data-station-id="${station.id}">
        <label style="display: block; margin-bottom: var(--space-2); font-size: var(--text-sm); font-weight: 600;">
          Reason for reporting:
        </label>
        <select id="flag-reason" style="width: 100%; padding: var(--space-2); border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); font-size: var(--text-sm); margin-bottom: var(--space-3);" required>
          <option value="">-- Select a reason --</option>
          <option value="doesnt_exist">Station doesn't exist</option>
          <option value="wrong_location">Wrong location</option>
          <option value="not_safe">Not safe to visit</option>
          <option value="duplicate">Duplicate entry</option>
          <option value="other">Other issue</option>
        </select>

        <label style="display: block; margin-bottom: var(--space-2); font-size: var(--text-sm); font-weight: 600;">
          Additional details (optional):
        </label>
        <textarea 
          id="flag-note" 
          placeholder="Tell us more..." 
          style="width: 100%; min-height: 4rem; padding: var(--space-2); border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); font-size: var(--text-sm); font-family: inherit; margin-bottom: var(--space-3); resize: vertical;"
        ></textarea>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);">
          <button 
            type="submit" 
            class="btn-primary" 
            style="display: flex; align-items: center; justify-content: center;"
          >
            Submit Report
          </button>
          <button 
            type="button" 
            id="cancel-flag-btn"
            class="btn-ghost" 
            style="display: flex; align-items: center; justify-content: center; color: var(--color-text-muted);"
          >
            Cancel
          </button>
        </div>

        <div id="flag-success" style="display: none; margin-top: var(--space-2); padding: var(--space-2); background: color-mix(in srgb, #22c55e 12%, transparent 88%); border-radius: var(--radius-md); color: #22c55e; font-size: var(--text-sm); text-align: center;">
          ✓ Report submitted. Thank you!
        </div>
      </form>

      <!-- Confirmation Tooltip -->
      <div id="confirm-tooltip" style="display: none; position: fixed; bottom: 20rem; left: 50%; transform: translateX(-50%); padding: var(--space-3) var(--space-4); border-radius: var(--radius-full); background: var(--color-primary); color: var(--color-primary-contrast); font-size: var(--text-sm); font-weight: 600; box-shadow: var(--shadow-lg); z-index: 100; white-space: nowrap; pointer-events: none; animation: fadeInOut 2s ease;">
        Thanks for the update!
      </div>

    </article>
  `;
}

function getFreshnessHTML(station: StationDetail): string {
  const days = station.last_confirmed_days ?? 9999;

  if (days < 1) {
    return `<div style="padding: var(--space-2); background: color-mix(in srgb, var(--color-primary) 10%, transparent 90%); border-radius: var(--radius-md); color: var(--color-primary); font-size: var(--text-xs); font-weight: 600;">
      ✓ Confirmed today
    </div>`;
  }

  if (days < 7) {
    return `<div style="padding: var(--space-2); background: color-mix(in srgb, var(--color-primary) 10%, transparent 90%); border-radius: var(--radius-md); color: var(--color-primary); font-size: var(--text-xs); font-weight: 600;">
      ✓ Confirmed ${days} day${days === 1 ? "" : "s"} ago
    </div>`;
  }

  if (days < 180) {
    return `<div style="padding: var(--space-2); background: color-mix(in srgb, #f59e0b 12%, transparent 88%); border-radius: var(--radius-md); color: #f59e0b; font-size: var(--text-xs); font-weight: 600;">
      ⚠ Confirmed ${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? "" : "s"} ago
    </div>`;
  }

  return `<div style="padding: var(--space-2); background: color-mix(in srgb, #ef4444 12%, transparent 88%); border-radius: var(--radius-md); color: #ef4444; font-size: var(--text-xs); font-weight: 600;">
    ⚠ Unconfirmed for 6+ months — status unknown
  </div>`;
}

function getStationTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    fountain: "💧",
    bottle_filler: "🍾",
    store_refill: "🏪",
    tap: "🚰",
  };
  return icons[type] ?? "💧";
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c] ?? "");
}

// ============================================================================
// Event Listeners
// ============================================================================

function attachEventListeners(sheet: HTMLElement): void {
  // Confirmation buttons
  const confirmWorkingBtn = sheet.querySelector("#confirm-working");
  const confirmNotWorkingBtn = sheet.querySelector("#confirm-not-working");

  if (confirmWorkingBtn) {
    confirmWorkingBtn.addEventListener("click", () => {
      handleConfirmation(true, sheet);
    });
  }

  if (confirmNotWorkingBtn) {
    confirmNotWorkingBtn.addEventListener("click", () => {
      handleConfirmation(false, sheet);
    });
  }

  // Save button
  const saveBtn = sheet.querySelector("#save-station-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      handleSaveStation(saveBtn);
    });
  }

  // Directions button
  const directionsBtn = sheet.querySelector("#directions-btn");
  if (directionsBtn) {
    directionsBtn.addEventListener("click", () => {
      handleDirections(directionsBtn);
    });
  }

  // Report Issue button
  const reportBtn = sheet.querySelector("#report-issue-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", () => {
      const flagForm = sheet.querySelector("#flag-form") as HTMLFormElement;
      if (flagForm) flagForm.style.display = "block";
    });
  }

  // Cancel flag button
  const cancelFlagBtn = sheet.querySelector("#cancel-flag-btn");
  if (cancelFlagBtn) {
    cancelFlagBtn.addEventListener("click", () => {
      const flagForm = sheet.querySelector("#flag-form") as HTMLFormElement;
      if (flagForm) flagForm.style.display = "none";
    });
  }

  // Flag form submission
  const flagForm = sheet.querySelector("#flag-form") as HTMLFormElement;
  if (flagForm) {
    flagForm.addEventListener("submit", (e) => {
      handleFlagSubmit(e, flagForm);
    });
  }

  // Add Photo (placeholder)
  const addPhotoBtn = sheet.querySelector("#add-photo-btn");
  if (addPhotoBtn) {
    addPhotoBtn.addEventListener("click", () => {
      console.log("Add photo feature coming in Phase 5");
    });
  }

  // Photo loading
  const photoImg = sheet.querySelector<HTMLImageElement>("#station-photo");
  if (photoImg) {
    const skeleton = sheet.querySelector<HTMLElement>("#photo-skeleton");
    if (skeleton) skeleton.style.display = "block";

    photoImg.addEventListener("load", () => {
      if (skeleton) skeleton.style.display = "none";
      photoImg.style.animation = "fadeIn 0.3s ease-in";
    });

    photoImg.addEventListener("error", () => {
      if (skeleton) skeleton.style.display = "none";
      photoImg.style.display = "none";
    });
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

async function handleConfirmation(isWorking: boolean, sheet: HTMLElement): Promise<void> {
  if (!currentStation || hasConfirmedThisSession) return;

  const workingCount = sheet.querySelector("#working-count");
  const notWorkingCount = sheet.querySelector("#not-working-count");
  const confirmWorkingBtn = sheet.querySelector("#confirm-working");
  const confirmNotWorkingBtn = sheet.querySelector("#confirm-not-working");

  if (!workingCount || !notWorkingCount) return;

  // Optimistic UI: update counts immediately
  const oldWorkingCount = currentStation.working_count;
  const oldNotWorkingCount = currentStation.not_working_count;

  if (isWorking) {
    currentStation.working_count += 1;
  } else {
    currentStation.not_working_count += 1;
  }

  workingCount.textContent = String(currentStation.working_count);
  notWorkingCount.textContent = String(currentStation.not_working_count);

  // Disable buttons
  hasConfirmedThisSession = true;
  if (confirmWorkingBtn) (confirmWorkingBtn as HTMLButtonElement).disabled = true;
  if (confirmNotWorkingBtn) (confirmNotWorkingBtn as HTMLButtonElement).disabled = true;

  // Show tooltip
  const tooltip = sheet.querySelector("#confirm-tooltip") as HTMLElement;
  if (tooltip) {
    tooltip.style.display = "block";
    setTimeout(() => {
      tooltip.style.display = "none";
    }, 2500);
  }

  try {
    await confirmStation(currentStation.id, isWorking);
  } catch (error) {
    console.error("Failed to submit confirmation:", error);
    // Revert optimistic update
    currentStation.working_count = oldWorkingCount;
    currentStation.not_working_count = oldNotWorkingCount;
    workingCount.textContent = String(oldWorkingCount);
    notWorkingCount.textContent = String(oldNotWorkingCount);

    // Re-enable buttons
    hasConfirmedThisSession = false;
    if (confirmWorkingBtn) (confirmWorkingBtn as HTMLButtonElement).disabled = false;
    if (confirmNotWorkingBtn) (confirmNotWorkingBtn as HTMLButtonElement).disabled = false;

    // Hide tooltip
    if (tooltip) tooltip.style.display = "none";
  }
}

function handleSaveStation(btn: Element): void {
  if (!currentStation) return;

  const isSaved = savedStationIds.has(currentStation.id);

  if (isSaved) {
    savedStationIds.delete(currentStation.id);
  } else {
    savedStationIds.add(currentStation.id);
  }

  // Update localStorage
  localStorage.setItem("savedStationIds", JSON.stringify(Array.from(savedStationIds)));

  // Update UI
  const saveIcon = btn.querySelector("#save-icon");
  if (saveIcon) saveIcon.textContent = isSaved ? "☆" : "⭐";
  btn.textContent = (isSaved ? "☆ Save" : "⭐ Saved").replace(/[\s]+/g, " ").trim();
  if (saveIcon) btn.prepend(saveIcon);
}

function handleDirections(btn: Element): void {
  const lat = btn.getAttribute("data-lat");
  const lng = btn.getAttribute("data-lng");

  if (!lat || !lng) return;

  const url = `https://maps.google.com/?q=${lat},${lng}`;
  window.open(url, "_blank");
}

async function handleFlagSubmit(e: Event, form: HTMLFormElement): Promise<void> {
  e.preventDefault();

  if (!currentStation) return;

  const reasonSelect = form.querySelector<HTMLSelectElement>("#flag-reason");
  const noteTextarea = form.querySelector<HTMLTextAreaElement>("#flag-note");
  const successDiv = form.querySelector("#flag-success") as HTMLElement;

  if (!reasonSelect || !reasonSelect.value) {
    alert("Please select a reason");
    return;
  }

  try {
    await flagStation({
      station_id: currentStation.id,
      reason: reasonSelect.value,
      note: noteTextarea?.value,
    });

    // Show success message
    if (successDiv) {
      successDiv.style.display = "block";
      reasonSelect.value = "";
      if (noteTextarea) noteTextarea.value = "";

      setTimeout(() => {
        form.style.display = "none";
        successDiv.style.display = "none";
      }, 3000);
    }
  } catch (error) {
    console.error("Failed to submit flag:", error);
    alert("Failed to submit report. Please try again.");
  }
}

// ============================================================================
// CSS Animations (inject into styles if not present)
// ============================================================================

const animationStyleId = "station-detail-animations";
if (!document.getElementById(animationStyleId)) {
  const style = document.createElement("style");
  style.id = animationStyleId;
  style.textContent = `
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes fadeInOut {
      0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
      10% { opacity: 1; transform: translateX(-50%) translateY(0); }
      90% { opacity: 1; transform: translateX(-50%) translateY(0); }
      100% { opacity: 0; transform: translateX(-50%) translateY(10px); }
    }

    .station-detail {
      display: grid;
      gap: var(--space-4);
    }
  `;
  document.head.appendChild(style);
}
