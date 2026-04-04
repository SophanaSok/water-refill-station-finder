import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";

const map = new maplibregl.Map({
  container: "app",
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
