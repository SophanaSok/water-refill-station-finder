import maplibregl from "maplibre-gl";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <div class="app-shell">
    <div id="map" class="map-canvas"></div>
    <form class="search-bar" role="search" aria-label="Search stations">
      <span aria-hidden="true">🔎</span>
      <input type="search" placeholder="Search by city, ZIP, or station name" />
    </form>
    <div class="filter-pills" role="toolbar" aria-label="Filters">
      <button class="filter-pill" data-active="true" aria-pressed="true">All</button>
      <button class="filter-pill" aria-pressed="false">Free</button>
      <button class="filter-pill" aria-pressed="false">Fountain</button>
      <button class="filter-pill" aria-pressed="false">Bottle Filler</button>
      <button class="filter-pill" aria-pressed="false">Store Refill</button>
    </div>
    <div class="fab-group">
      <button class="fab" aria-label="Center map">📍</button>
      <button class="fab" aria-label="Add station">＋</button>
    </div>
    <section class="bottom-sheet" data-state="peek" aria-label="Station details panel">
      <div class="handle" aria-hidden="true"></div>
      <div class="content">
        <article class="station-card">
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
          <div class="actions">
            <button class="btn-secondary">👍 0</button>
            <button class="btn-secondary">👎 0</button>
          </div>
        </div>
      </div>
    </section>
    <nav class="bottom-nav" aria-label="Primary navigation">
      <button class="bottom-nav__item" data-active="true"><span class="icon">🗺️</span><span>Map</span></button>
      <button class="bottom-nav__item"><span class="icon">➕</span><span>Submit</span></button>
      <button class="bottom-nav__item"><span class="icon">⭐</span><span>Saved</span></button>
      <button class="bottom-nav__item"><span class="icon">⚙️</span><span>Settings</span></button>
    </nav>
    <div class="overlay" data-open="false">
      <div class="panel">
        <h3 style="font-size: var(--text-lg);">Add a New Station</h3>
        <p style="margin-top: var(--space-2); color: var(--color-text-muted);">
          Use the floating add button to open the full station submission form.
        </p>
        <div style="margin-top: var(--space-4); display: flex; gap: var(--space-2);">
          <button class="btn-primary" type="button">Continue</button>
          <button class="btn-ghost" type="button">Cancel</button>
        </div>
      </div>
    </div>
  </div>
`;

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-98.5795, 39.8283],
  zoom: 4,
});

map.addControl(new maplibregl.NavigationControl());
map.addControl(
  new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
  })
);
