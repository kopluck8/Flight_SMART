// Penulis format keluaran: GPX, KML, GeoJSON, CSV, dan track.json (dipakai aplikasi web).

import { validCoord, frameTimeMs, round, localIso } from "./track.mjs";

const esc = (s) =>
  String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

function describe(info) {
  return [
    info.aircraft && `Pesawat: ${info.aircraft}`,
    info.location,
    Number.isFinite(info.distanceM) && `Jarak: ${info.distanceM} m`,
    Number.isFinite(info.durationSec) && `Durasi: ${Math.round(info.durationSec / 60)} menit`,
    Number.isFinite(info.maxHeightM) && `Tinggi maks: ${info.maxHeightM} m`,
  ].filter(Boolean).join(" | ");
}

export function toGpx(track, info) {
  const pts = track.map((p) =>
    `      <trkpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}">\n` +
    `        <ele>${(p.alt ?? 0).toFixed(2)}</ele>\n` +
    (p.timeMs !== null ? `        <time>${iso(p.timeMs)}</time>\n` : "") +
    (Number.isFinite(p.sats) ? `        <sat>${p.sats}</sat>\n` : "") +
    `        <extensions>\n` +
    `          <dji:height>${(p.height ?? 0).toFixed(2)}</dji:height>\n` +
    `          <dji:speed>${p.speed.toFixed(2)}</dji:speed>\n` +
    `          <dji:vspeed>${p.vspeed.toFixed(2)}</dji:vspeed>\n` +
    `          <dji:yaw>${p.yaw.toFixed(1)}</dji:yaw>\n` +
    (Number.isFinite(p.battery) ? `          <dji:battery>${p.battery}</dji:battery>\n` : "") +
    `        </extensions>\n` +
    `      </trkpt>`
  );
  const home = info.home;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Flight_SMART" xmlns="http://www.topografix.com/GPX/1/1"\n` +
    `     xmlns:dji="https://github.com/lvauvillier/dji-log-parser"\n` +
    `     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
    `     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n` +
    `  <metadata>\n    <name>${esc(info.name)}</name>\n` +
    `    <desc>${esc(describe(info))}</desc>\n` +
    (info.startMs ? `    <time>${iso(info.startMs)}</time>\n` : "") +
    `  </metadata>\n` +
    (home
      ? `  <wpt lat="${home.lat.toFixed(8)}" lon="${home.lon.toFixed(8)}">\n` +
        `    <ele>${(home.alt ?? 0).toFixed(2)}</ele>\n    <name>Home</name>\n  </wpt>\n`
      : "") +
    `  <trk>\n    <name>${esc(info.name)}</name>\n    <type>drone</type>\n    <trkseg>\n` +
    pts.join("\n") + (pts.length ? "\n" : "") +
    `    </trkseg>\n  </trk>\n</gpx>\n`
  );
}

export function toKml(track, info) {
  const coords = track.map((p) => `${p.lon.toFixed(8)},${p.lat.toFixed(8)},${(p.alt ?? 0).toFixed(2)}`).join("\n          ");
  const home = info.home;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n` +
    `    <name>${esc(info.name)}</name>\n    <description>${esc(describe(info))}</description>\n` +
    `    <Style id="track"><LineStyle><color>ff00d7ff</color><width>3</width></LineStyle></Style>\n` +
    `    <Placemark>\n      <name>${esc(info.name)}</name>\n      <styleUrl>#track</styleUrl>\n` +
    `      <LineString>\n        <altitudeMode>absolute</altitudeMode>\n        <coordinates>\n          ${coords}\n        </coordinates>\n      </LineString>\n    </Placemark>\n` +
    (home
      ? `    <Placemark>\n      <name>Home</name>\n      <Point><coordinates>${home.lon.toFixed(8)},${home.lat.toFixed(8)},${(home.alt ?? 0).toFixed(2)}</coordinates></Point>\n    </Placemark>\n`
      : "") +
    `  </Document>\n</kml>\n`
  );
}

/** GeoJSON ini ditampilkan GitHub sebagai peta interaktif. */
export function toGeoJson(track, info, photoEvents = []) {
  const features = [
    {
      type: "Feature",
      properties: {
        name: info.name,
        aircraft: info.aircraft,
        start: info.startLocal,
        durationMin: Math.round((info.durationSec || 0) / 60),
        distanceM: info.distanceM,
        maxHeightM: info.maxHeightM,
        stroke: "#e0a100",
        "stroke-width": 3,
      },
      geometry: { type: "LineString", coordinates: track.map((p) => [round(p.lon, 7), round(p.lat, 7), round(p.alt, 1)]) },
    },
  ];
  if (info.home) {
    features.push({
      type: "Feature",
      properties: { name: "Home", "marker-symbol": "heliport", "marker-color": "#1f6feb" },
      geometry: { type: "Point", coordinates: [round(info.home.lon, 7), round(info.home.lat, 7)] },
    });
  }
  photoEvents.forEach((e, i) => {
    features.push({
      type: "Feature",
      properties: { name: `Foto ${i + 1}`, time: info.tz ? localIso(e.timeMs, info.tz) : iso(e.timeMs), heightM: round(e.height, 1), "marker-symbol": "camera", "marker-size": "small", "marker-color": "#d1242f" },
      geometry: { type: "Point", coordinates: [round(e.lon, 7), round(e.lat, 7)] },
    });
  });
  return JSON.stringify({ type: "FeatureCollection", features });
}

/** track.json: format ringkas untuk aplikasi web (peta, pencocokan foto, ekspor SMART). */
export function toTrackJson(track, info, photoEvents = []) {
  const t0 = track.find((p) => p.timeMs !== null)?.timeMs ?? info.startMs ?? null;
  const rel = (ms) => (ms === null || t0 === null ? null : round((ms - t0) / 1000, 1));
  return JSON.stringify({
    t0,
    fields: ["t", "lon", "lat", "alt", "height", "speed", "sats"],
    points: track.map((p) => [rel(p.timeMs), round(p.lon, 7), round(p.lat, 7), round(p.alt, 1), round(p.height, 1), round(p.speed, 1), p.sats ?? null]),
    photos: photoEvents.map((e) => [rel(e.timeMs), round(e.lon, 7), round(e.lat, 7), round(e.alt, 1), round(e.height, 1), round(e.gimbalPitch, 1), round(e.yaw, 1)]),
  });
}

const CSV_COLUMNS = [
  ["datetime_utc", (f) => { const ms = frameTimeMs(f); return ms === null ? "" : iso(ms); }],
  ["datetime_local", (f, tz) => localIso(frameTimeMs(f), tz, { millis: true }) ?? ""],
  ["fly_time_s", (f) => round(f.osd.flyTime, 1)],
  ["latitude", (f) => (validCoord(f.osd.latitude, f.osd.longitude) ? f.osd.latitude.toFixed(8) : "")],
  ["longitude", (f) => (validCoord(f.osd.latitude, f.osd.longitude) ? f.osd.longitude.toFixed(8) : "")],
  ["height_m", (f) => round(f.osd.height, 2)],
  ["altitude_msl_m", (f) => round(f.osd.altitude, 2)],
  ["vps_height_m", (f) => round(f.osd.vpsHeight, 2)],
  ["speed_h_ms", (f) => round(Math.hypot(f.osd.xSpeed || 0, f.osd.ySpeed || 0), 2)],
  ["speed_v_ms", (f) => round(f.osd.zSpeed, 2)],
  ["x_speed_ms", (f) => round(f.osd.xSpeed, 2)],
  ["y_speed_ms", (f) => round(f.osd.ySpeed, 2)],
  ["pitch_deg", (f) => round(f.osd.pitch, 1)],
  ["roll_deg", (f) => round(f.osd.roll, 1)],
  ["yaw_deg", (f) => round(f.osd.yaw, 1)],
  ["gps_satellites", (f) => f.osd.gpsNum],
  ["gps_level", (f) => f.osd.gpsLevel],
  ["flight_mode", (f) => (typeof f.osd.flycState === "string" ? f.osd.flycState : JSON.stringify(f.osd.flycState ?? ""))],
  ["is_on_ground", (f) => f.osd.isOnGround],
  ["is_motor_on", (f) => f.osd.isMotorOn],
  ["gimbal_pitch_deg", (f) => round(f.gimbal?.pitch, 1)],
  ["gimbal_yaw_deg", (f) => round(f.gimbal?.yaw, 1)],
  ["is_photo", (f) => f.camera?.isPhoto],
  ["is_video", (f) => f.camera?.isVideo],
  ["battery_percent", (f) => f.battery?.chargeLevel],
  ["battery_voltage_v", (f) => round(f.battery?.voltage, 3)],
  ["battery_current_a", (f) => round(f.battery?.current, 3)],
  ["battery_temp_c", (f) => round(f.battery?.temperature, 1)],
  ["rc_aileron", (f) => f.rc?.aileron],
  ["rc_elevator", (f) => f.rc?.elevator],
  ["rc_throttle", (f) => f.rc?.throttle],
  ["rc_rudder", (f) => f.rc?.rudder],
  ["rc_downlink_signal", (f) => f.rc?.downlinkSignal ?? ""],
  ["rc_uplink_signal", (f) => f.rc?.uplinkSignal ?? ""],
  ["home_latitude", (f) => (f.home && validCoord(f.home.latitude, f.home.longitude) ? f.home.latitude.toFixed(8) : "")],
  ["home_longitude", (f) => (f.home && validCoord(f.home.latitude, f.home.longitude) ? f.home.longitude.toFixed(8) : "")],
  ["app_tip", (f) => f.app?.tip ?? ""],
  ["app_warning", (f) => f.app?.warn ?? ""],
];

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(frames, tz) {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(",")];
  for (const f of frames) {
    if (!f.osd) continue;
    lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(f, tz))).join(","));
  }
  return lines.join("\n") + "\n";
}
