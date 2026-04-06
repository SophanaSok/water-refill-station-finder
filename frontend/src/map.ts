import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

export type StationFilters = {
  type?: string;
  is_free?: boolean;
};

export type GeoJSONStationProperties = {
  id: string;
  name: string;
  type: string;
  is_free: boolean;
  is_verified: boolean;
  city: string;
  state: string;
  last_confirmed_days: number;
};

type StationFeatureCollection = FeatureCollection<GeoJSON.Point, GeoJSONStationProperties>;

type Center = { lng: number; lat: number };

class MapControllerImpl {
  private readonly map: Map;
  private readonly stationPreviewPopup: maplibregl.Popup;
  private stationClickCallback: (stationId: string) => void = () => {};
  private mapMoveCallback: (center: Center) => void = () => {};
  private visibleStationsCallback: (count: number) => void = () => {};
  private currentFilters: StationFilters = {};
  private pendingData: StationFeatureCollection | null = null;
  private hasLoadedStations = false;
  private userLocationInitialized = false;
  private readonly defaultRadiusMeters = 8047;
  private stationsAbortController: AbortController | null = null;
  private refetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stationsQueryCache = new globalThis.Map<
    string,
    { payload: StationFeatureCollection; expiresAt: number }
  >();
  private readonly stationsCacheTtlMs = 30_000;

  constructor(containerId: string) {
    this.map = new maplibregl.Map({
      container: containerId,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-98.5, 39.5],
      zoom: 4,
    });
    this.stationPreviewPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: "station-preview-popup",
    });

    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
    this.map.addControl(
      new maplibregl.GeolocateControl({
        trackUserLocation: true,
        showUserLocation: true,
      }),
      "top-right",
    );

    this.map.on("load", () => {
      this.initializeStationLayers();
      if (this.pendingData) {
        this.updateStationSource(this.pendingData);
      }
      this.emitVisibleStationsCount();
    });

    this.map.on("moveend", () => {
      this.mapMoveCallback(this.getCurrentCenter());
    });
  }

  flyTo(lng: number, lat: number, zoom = 14): void {
    this.map.flyTo({ center: [lng, lat], zoom });
  }

  loadStations(geojson: FeatureCollection): void {
    const typed = geojson as StationFeatureCollection;
    this.pendingData = typed;
    this.hasLoadedStations = true;

    if (!this.map.isStyleLoaded()) {
      return;
    }

    this.updateStationSource(typed);
    this.emitVisibleStationsCount();
  }

  setFilter(filters: StationFilters): void {
    const nextFilters = { ...filters };
    const unchanged =
      this.currentFilters.type === nextFilters.type &&
      this.currentFilters.is_free === nextFilters.is_free;

    if (unchanged) {
      return;
    }

    this.currentFilters = nextFilters;

    if (this.refetchDebounceTimer) {
      clearTimeout(this.refetchDebounceTimer);
    }

    this.refetchDebounceTimer = setTimeout(() => {
      void this.refetchStations();
    }, 120);
  }

  showUserLocation(lng: number, lat: number): void {
    const sourceId = "user-location";
    const layerId = "user-location-dot";
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          properties: {},
        },
      ],
    };

    if (!this.map.isStyleLoaded()) {
      this.map.once("load", () => {
        this.showUserLocation(lng, lat);
      });
      return;
    }

    if (!this.userLocationInitialized) {
      this.map.addSource(sourceId, {
        type: "geojson",
        data,
      });

      this.map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-color": "#ffffff",
          "circle-stroke-color": "#01696f",
          "circle-stroke-width": 3,
          "circle-radius": 7,
        },
      });

      this.userLocationInitialized = true;
      return;
    }

    (this.map.getSource(sourceId) as GeoJSONSource).setData(data);
  }

  onStationClick(callback: (stationId: string) => void): void {
    this.stationClickCallback = callback;
  }

  onMapMove(callback: (center: Center) => void): void {
    this.mapMoveCallback = callback;
  }

  onVisibleStationsChange(callback: (count: number) => void): void {
    this.visibleStationsCallback = callback;
    this.emitVisibleStationsCount();
  }

  getCurrentCenter(): Center {
    const center = this.map.getCenter();
    return { lng: center.lng, lat: center.lat };
  }

  private initializeStationLayers(): void {
    this.map.addSource("stations", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 40,
    });

    this.map.addLayer({
      id: "clusters",
      type: "circle",
      source: "stations",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#01696f",
        "circle-radius": ["step", ["get", "point_count"], 20, 10, 28, 50, 36, 200, 44],
        "circle-opacity": 0.9,
      },
    });

    this.map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "stations",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

    this.map.addLayer({
      id: "unclustered-point",
      type: "circle",
      source: "stations",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "match",
          ["get", "type"],
          "fountain",
          "#01696f",
          "bottle_filler",
          "#006494",
          "store_refill",
          "#437a22",
          "tap",
          "#7a39bb",
          "#01696f",
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 8, 10, 10, 14, 12, 18, 14],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.25, 12, 2.5, 18, 3],
        "circle-opacity": [
          "case",
          [">=", ["coalesce", ["get", "last_confirmed_days"], 9999], 180],
          0.8,
          0.98,
        ],
        "circle-blur": 0.02,
      },
    });

    this.map.addLayer({
      id: "unclustered-point-stale-ring",
      type: "circle",
      source: "stations",
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        [">=", ["coalesce", ["get", "last_confirmed_days"], 9999], 180],
      ],
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 11, 8, 12, 14, 14, 18, 16],
        "circle-stroke-color": "#f59e0b",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 1.25, 8, 1.5, 14, 2, 18, 2.5],
      },
    });

    this.map.on("click", "clusters", (event) => {
      const features = this.map.queryRenderedFeatures(event.point, { layers: ["clusters"] });
      const firstFeature = features[0];
      const clusterId = firstFeature?.properties?.cluster_id;

      if (typeof clusterId !== "number") {
        return;
      }

      const source = this.map.getSource("stations") as GeoJSONSource;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const coordinates = (firstFeature.geometry as GeoJSON.Point).coordinates;
        this.map.easeTo({
          center: [coordinates[0], coordinates[1]],
          zoom,
        });
      });
    });

    this.map.on("click", "unclustered-point", (event) => {
      const firstFeature = event.features?.[0];
      const stationId = firstFeature?.properties?.id;

      if (typeof stationId === "string") {
        this.showStationPreview(firstFeature, true);
      }
    });

    this.map.on("mousemove", "unclustered-point", (event) => {
      const firstFeature = event.features?.[0];
      this.showStationPreview(firstFeature, false);
    });

    this.map.on("mouseenter", "clusters", () => {
      this.map.getCanvas().style.cursor = "pointer";
    });

    this.map.on("mouseleave", "clusters", () => {
      this.map.getCanvas().style.cursor = "";
    });

    this.map.on("mouseenter", "unclustered-point", () => {
      this.map.getCanvas().style.cursor = "pointer";
    });

    this.map.on("mouseleave", "unclustered-point", () => {
      this.map.getCanvas().style.cursor = "";
      this.stationPreviewPopup.remove();
    });

    this.map.on("movestart", () => {
      this.stationPreviewPopup.remove();
    });

    this.map.getContainer().addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("[data-station-preview-open]");
      if (!button) {
        return;
      }

      const stationId = button.getAttribute("data-station-preview-open");
      if (!stationId) {
        return;
      }

      this.stationPreviewPopup.remove();
      this.stationClickCallback(stationId);
    });
  }

  private showStationPreview(feature: maplibregl.MapGeoJSONFeature | undefined, includeAction: boolean): void {
    const geometry = feature?.geometry;
    const properties = feature?.properties as Partial<GeoJSONStationProperties> | undefined;

    if (!geometry || geometry.type !== "Point" || !properties) {
      this.stationPreviewPopup.remove();
      return;
    }

    const [lng, lat] = geometry.coordinates;
    const popupHtml = this.buildStationPreviewHtml(properties, includeAction);

    this.stationPreviewPopup
      .setLngLat([lng, lat])
      .setHTML(popupHtml)
      .addTo(this.map);
  }

  private buildStationPreviewHtml(properties: Partial<GeoJSONStationProperties>, includeAction: boolean): string {
    const stationName = this.escapeHtml(properties.name || "Water refill station");
    const stationTypeRaw = (properties.type || "unknown").replace(/_/g, " ");
    const stationType = this.escapeHtml(stationTypeRaw.replace(/\b\w/g, (char) => char.toUpperCase()));
    const cost = properties.is_free ? "Free" : "Paid";
    const verification = properties.is_verified ? "Verified" : "Unverified";
    const locationParts = [properties.city, properties.state].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    const location = this.escapeHtml(locationParts.join(", ") || "Location unknown");
    const freshness = this.escapeHtml(this.getFreshnessLabel(properties.last_confirmed_days));
    const stationId = typeof properties.id === "string" ? this.escapeHtml(properties.id) : "";
    const actionHtml = includeAction && stationId
      ? `<button type="button" class="station-preview__action" data-station-preview-open="${stationId}">View details</button>`
      : "";

    return `
      <article class="station-preview">
        <h4>${stationName}</h4>
        <p>${stationType}</p>
        <div class="station-preview__meta">
          <span>${cost}</span>
          <span>${verification}</span>
        </div>
        <p>${freshness}</p>
        <p>${location}</p>
        ${actionHtml}
      </article>
    `;
  }

  private getFreshnessLabel(lastConfirmedDays: number | undefined): string {
    const days = typeof lastConfirmedDays === "number" ? lastConfirmedDays : 9999;

    if (days < 1) {
      return "Confirmed today";
    }

    if (days < 7) {
      return `Confirmed ${days} day${days === 1 ? "" : "s"} ago`;
    }

    if (days < 180) {
      const months = Math.max(1, Math.floor(days / 30));
      return `Confirmed ${months} month${months === 1 ? "" : "s"} ago`;
    }

    return "Not confirmed recently";
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private updateStationSource(data: StationFeatureCollection): void {
    const source = this.map.getSource("stations") as GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    source.setData(data);
    this.emitVisibleStationsCount();
  }

  private emitVisibleStationsCount(): void {
    if (!this.hasLoadedStations) {
      return;
    }

    const loadedCount = this.pendingData?.features.length ?? 0;
    this.visibleStationsCallback(loadedCount);
  }

  private async refetchStations(): Promise<void> {
    this.stationsAbortController?.abort();
    this.stationsAbortController = new AbortController();

    const center = this.getCurrentCenter();
    const params = new URLSearchParams({
      lat: String(center.lat),
      lng: String(center.lng),
      radius: String(this.defaultRadiusMeters),
      geojson: "true",
    });

    if (this.currentFilters.type) {
      params.set("type", this.currentFilters.type);
    }

    if (typeof this.currentFilters.is_free === "boolean") {
      params.set("is_free", String(this.currentFilters.is_free));
    }

    const cacheKey = params.toString();
    const cached = this.stationsQueryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.loadStations(cached.payload);
      this.stationsAbortController = null;
      return;
    }

    try {
      const response = await fetch(`/api/stations?${params.toString()}`, {
        signal: this.stationsAbortController.signal,
      });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as FeatureCollection;
      const typedPayload = payload as StationFeatureCollection;
      this.stationsQueryCache.set(cacheKey, {
        payload: typedPayload,
        expiresAt: Date.now() + this.stationsCacheTtlMs,
      });
      this.loadStations(typedPayload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      return;
    } finally {
      this.stationsAbortController = null;
    }
  }
}

export type MapController = {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
  loadStations: (geojson: FeatureCollection) => void;
  setFilter: (filters: StationFilters) => void;
  showUserLocation: (lng: number, lat: number) => void;
  onStationClick: (callback: (stationId: string) => void) => void;
  onMapMove: (callback: (center: { lng: number; lat: number }) => void) => void;
  onVisibleStationsChange: (callback: (count: number) => void) => void;
  getCurrentCenter: () => { lng: number; lat: number };
};

export function initMap(containerId: string): MapController {
  return new MapControllerImpl(containerId);
}