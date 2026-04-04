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
  private stationClickCallback: (stationId: string) => void = () => {};
  private mapMoveCallback: (center: Center) => void = () => {};
  private currentFilters: StationFilters = {};
  private pendingData: StationFeatureCollection | null = null;
  private userLocationInitialized = false;
  private readonly defaultRadiusMeters = 8047;

  constructor(containerId: string) {
    this.map = new maplibregl.Map({
      container: containerId,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-98.5, 39.5],
      zoom: 4,
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

    if (!this.map.isStyleLoaded()) {
      return;
    }

    this.updateStationSource(typed);
  }

  setFilter(filters: StationFilters): void {
    this.currentFilters = { ...filters };
    void this.refetchStations();
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
        "circle-radius": 9,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": [
          "case",
          [">=", ["coalesce", ["get", "last_confirmed_days"], 9999], 180],
          0.5,
          1,
        ],
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
        "circle-radius": 12,
        "circle-stroke-color": "#f59e0b",
        "circle-stroke-width": 1.5,
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
        this.stationClickCallback(stationId);
      }
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
    });
  }

  private updateStationSource(data: StationFeatureCollection): void {
    const source = this.map.getSource("stations") as GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    source.setData(data);
  }

  private async refetchStations(): Promise<void> {
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

    try {
      const response = await fetch(`/api/stations?${params.toString()}`);
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as FeatureCollection;
      this.loadStations(payload);
    } catch {
      return;
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
  getCurrentCenter: () => { lng: number; lat: number };
};

export function initMap(containerId: string): MapController {
  return new MapControllerImpl(containerId);
}