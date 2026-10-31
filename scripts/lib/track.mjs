// Mengubah frame hasil dji-log-parser-js menjadi titik track dan ringkasan penerbangan.

export const validCoord = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) &&
  !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export function frameTimeMs(frame) {
  const ms = Date.parse(frame?.custom?.dateTime ?? "");
  // Log tanpa jam yang valid (sebelum GPS/ponsel sinkron) memakai tahun 1970.
  return Number.isFinite(ms) && ms > Date.UTC(2010, 0, 1) ? ms : null;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Titik track berinterval `intervalSec` (0 = semua frame dengan GPS valid).
 * Frame dengan koordinat sama persis dengan titik sebelumnya dilewati.
 */
export function extractTrack(frames, { intervalSec = 1 } = {}) {
  const pts = [];
  let last = null;
  for (const f of frames) {
    const o = f.osd;
    if (!o || !validCoord(o.latitude, o.longitude)) continue;
    if (last && intervalSec > 0 && o.flyTime - last.flyTime < intervalSec && !f.camera?.isPhoto) continue;
    if (last && last.lat === o.latitude && last.lon === o.longitude && last.alt === o.altitude) continue;
    last = {
      timeMs: frameTimeMs(f),
      flyTime: o.flyTime,
      lat: o.latitude,
      lon: o.longitude,
      alt: o.altitude,
      height: o.height,
      speed: Math.hypot(o.xSpeed || 0, o.ySpeed || 0),
      vspeed: o.zSpeed || 0,
      yaw: o.yaw || 0,
      sats: o.gpsNum,
      battery: f.battery?.chargeLevel,
    };
    pts.push(last);
  }
  return pts;
}

/** Saat kamera memotret (tepi naik flag isPhoto), lengkap dengan posisi drone. */
export function extractPhotoEvents(frames) {
  const events = [];
  let prev = false;
  for (const f of frames) {
    const now = Boolean(f.camera?.isPhoto);
    if (now && !prev && f.osd && validCoord(f.osd.latitude, f.osd.longitude)) {
      events.push({
        timeMs: frameTimeMs(f),
        flyTime: f.osd.flyTime,
        lat: f.osd.latitude,
        lon: f.osd.longitude,
        alt: f.osd.altitude,
        height: f.osd.height,
        gimbalPitch: f.gimbal?.pitch,
        yaw: f.gimbal?.yaw ?? f.osd.yaw,
      });
    }
    prev = now;
  }
  return events;
}

export function summarize(frames, details, track) {
  let distance = 0;
  let maxHeight = -Infinity, maxAlt = -Infinity, maxSpeed = 0, maxDist = 0;
  let prev = null;
  let videoFrames = 0;
  const home = frames.find((f) => f.home && validCoord(f.home.latitude, f.home.longitude))?.home;
  for (const f of frames) {
    const o = f.osd;
    if (f.camera?.isVideo) videoFrames++;
    if (!o || !validCoord(o.latitude, o.longitude)) continue;
    if (prev) {
      const d = haversine(prev.latitude, prev.longitude, o.latitude, o.longitude);
      if (d < 200) distance += d; // abaikan lompatan GPS yang tidak wajar
    }
    prev = o;
    maxHeight = Math.max(maxHeight, o.height);
    maxAlt = Math.max(maxAlt, o.altitude);
    maxSpeed = Math.max(maxSpeed, Math.hypot(o.xSpeed || 0, o.ySpeed || 0));
    if (home) maxDist = Math.max(maxDist, haversine(home.latitude, home.longitude, o.latitude, o.longitude));
  }
  const times = frames.map(frameTimeMs).filter((t) => t !== null);
  const startMs = times.length ? times[0] : Date.parse(details?.startTime ?? "") || null;
  const endMs = times.length ? times[times.length - 1] : null;
  const lons = track.map((p) => p.lon), lats = track.map((p) => p.lat);
  const lastFly = frames.length ? frames[frames.length - 1].osd?.flyTime : 0;
  return {
    startMs,
    endMs,
    durationSec: Math.round(Number(details?.totalTime) || lastFly || (endMs && startMs ? (endMs - startMs) / 1000 : 0)),
    distanceM: Math.round(distance),
    maxHeightM: Number.isFinite(maxHeight) ? round(maxHeight, 1) : null,
    maxAltitudeM: Number.isFinite(maxAlt) ? round(maxAlt, 1) : null,
    maxSpeedMs: round(maxSpeed, 1),
    maxDistanceFromHomeM: Math.round(maxDist),
    videoSec: Math.round(videoFrames / 10),
    home: home ? { lat: home.latitude, lon: home.longitude, alt: round(home.altitude, 1) } : null,
    bbox: track.length ? [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].map((v) => round(v, 6)) : null,
  };
}

export const round = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** "+08:00" -> 480 (menit). */
export function parseOffset(offset = "+00:00") {
  const m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(String(offset).trim());
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** Waktu lokal "YYYY-MM-DDTHH:MM:SS" (atau dengan milidetik) untuk offset tertentu. */
export function localIso(ms, offset, { millis = false } = {}) {
  if (ms === null || ms === undefined) return null;
  return new Date(ms + parseOffset(offset) * 60000).toISOString().slice(0, millis ? 23 : 19);
}
