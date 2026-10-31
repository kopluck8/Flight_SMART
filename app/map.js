// Peta Leaflet dengan citra satelit dan OpenStreetMap.

import L from "leaflet";

export function createMap(el) {
  const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Citra &copy; Esri",
  });
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  });
  const map = L.map(el, { layers: [satellite], zoomControl: true, attributionControl: true }).setView([-8.25, 118.0], 10);
  L.control.layers({ Satelit: satellite, OpenStreetMap: osm }, null, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  const overlay = L.featureGroup().addTo(map);
  return {
    map,
    overlay,
    clear() {
      overlay.clearLayers();
    },
    track(latlngs, color = "#f2b705") {
      if (latlngs.length < 2) return null;
      L.polyline(latlngs, { color: "#1b1b1b", weight: 6, opacity: 0.45 }).addTo(overlay);
      return L.polyline(latlngs, { color, weight: 3 }).addTo(overlay);
    },
    point(latlng, { color = "#d1242f", radius = 6, title = "", onClick } = {}) {
      const m = L.circleMarker(latlng, { radius, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(overlay);
      if (title) m.bindTooltip(title);
      if (onClick) m.on("click", onClick);
      return m;
    },
    fit() {
      const b = overlay.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 17 });
    },
    refresh() {
      setTimeout(() => map.invalidateSize(), 50);
    },
  };
}
