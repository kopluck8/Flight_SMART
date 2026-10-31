#!/usr/bin/env node
// Memproses semua log DJI di folder logs/ menjadi file siap unduh di flights/<id>/
// lalu memperbarui flights/index.json dan FLIGHTS.md.
//
//   node scripts/process-logs.mjs [--force]
//
// Env: DJI_API_KEY (wajib untuk log versi 13+), FLIGHT_SMART_ROOT (default: folder repo)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPhotoEvents, extractTrack, localIso, summarize } from "./lib/track.mjs";
import { toCsv, toGeoJson, toGpx, toKml, toTrackJson } from "./lib/formats.mjs";
import { renderFlightsMarkdown } from "./lib/flights-md.mjs";

const DEFAULT_CONFIG = { timezoneOffset: "+08:00", timezoneName: "WITA", trackIntervalSeconds: 1 };

function listLogs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return listLogs(p);
    return /\.txt$/i.test(d.name) ? [p] : [];
  });
}

const posix = (p) => p.split(sep).join("/");

function flightId(startMs, tz, fallback, taken) {
  const base = startMs
    ? localIso(startMs, tz).replace("T", "_").replace(/:/g, "")
    : fallback.replace(/\.txt$/i, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

export async function processAll({ root, force = false, apiKey = process.env.DJI_API_KEY, createParser, log = console.log } = {}) {
  root = resolve(root);
  const config = { ...DEFAULT_CONFIG, ...readJson(join(root, "flight-smart.config.json"), {}) };
  const tz = config.timezoneOffset;
  const indexPath = join(root, "flights", "index.json");
  const previousIndex = readJson(indexPath, { flights: [] });
  const previous = previousIndex.flights ?? [];
  const bySha = new Map(previous.map((f) => [f.sha256, f]));

  if (!createParser) {
    const { DJILog } = await import("dji-log-parser-js");
    createParser = (bytes) => new DJILog(bytes);
  }

  const logs = listLogs(join(root, "logs")).sort();
  const flights = [];
  const taken = new Set();
  const stats = { processed: 0, skipped: 0, failed: 0, removed: 0 };

  for (const file of logs) {
    const rel = posix(relative(root, file));
    const bytes = readFileSync(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const prev = bySha.get(sha256);
    if (prev && prev.status === "ok" && !force && existsSync(join(root, "flights", prev.id))) {
      flights.push({ ...prev, log: rel });
      taken.add(prev.id);
      stats.skipped++;
      continue;
    }

    try {
      const parser = createParser(new Uint8Array(bytes));
      let keychains;
      if (parser.version >= 13) {
        if (!apiKey) {
          throw new Error(
            `Log versi ${parser.version} terenkripsi. Tambahkan secret DJI_API_KEY di Settings → Secrets and variables → Actions, lalu jalankan ulang workflow.`
          );
        }
        keychains = await parser.fetchKeychains(apiKey);
      }
      const frames = parser.frames(keychains);
      const details = parser.details ?? {};
      const track = extractTrack(frames, { intervalSec: config.trackIntervalSeconds });
      if (!track.length) throw new Error("Tidak ada titik GPS valid di log ini (drone tidak mendapat sinyal GPS).");
      const photos = extractPhotoEvents(frames);
      const sum = summarize(frames, details, track);

      const id = prev?.id && !taken.has(prev.id) ? (taken.add(prev.id), prev.id) : flightId(sum.startMs, tz, rel.split("/").pop(), taken);
      const outDir = join(root, "flights", id);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });

      const info = {
        id,
        name: `${details.aircraftName || "DJI"} ${localIso(sum.startMs, tz)?.replace("T", " ") ?? id}`,
        aircraft: details.aircraftName || details.productType || "",
        location: [details.subStreet, details.street, details.city, details.area].filter(Boolean).join(", "),
        startLocal: localIso(sum.startMs, tz),
        tz,
        ...sum,
      };
      const files = {
        gpx: `flights/${id}/track.gpx`,
        kml: `flights/${id}/track.kml`,
        geojson: `flights/${id}/track.geojson`,
        csv: `flights/${id}/frames.csv`,
        track: `flights/${id}/track.json`,
      };
      writeFileSync(join(root, files.gpx), toGpx(track, info));
      writeFileSync(join(root, files.kml), toKml(track, info));
      writeFileSync(join(root, files.geojson), toGeoJson(track, info, photos));
      writeFileSync(join(root, files.csv), toCsv(frames, tz));
      writeFileSync(join(root, files.track), toTrackJson(track, info, photos));

      const entry = {
        id,
        status: "ok",
        log: rel,
        sha256,
        version: parser.version,
        aircraft: info.aircraft,
        product: typeof details.productType === "string" ? details.productType : "",
        aircraftSn: details.aircraftSn || "",
        app: [typeof details.appPlatform === "string" ? details.appPlatform : "", details.appVersion].filter(Boolean).join(" "),
        location: info.location,
        start: sum.startMs ? new Date(sum.startMs).toISOString() : null,
        startLocal: info.startLocal,
        end: sum.endMs ? new Date(sum.endMs).toISOString() : null,
        durationSec: sum.durationSec,
        distanceM: sum.distanceM,
        maxHeightM: sum.maxHeightM,
        maxAltitudeM: sum.maxAltitudeM,
        maxSpeedMs: sum.maxSpeedMs,
        maxDistanceFromHomeM: sum.maxDistanceFromHomeM,
        photos: photos.length,
        videoSec: sum.videoSec,
        points: track.length,
        home: sum.home,
        bbox: sum.bbox,
        files,
      };
      writeFileSync(join(outDir, "summary.json"), JSON.stringify(entry, null, 2) + "\n");
      flights.push(entry);
      stats.processed++;
      log(`OK     ${rel} -> flights/${id} (v${parser.version}, ${track.length} titik, ${photos.length} foto)`);
    } catch (e) {
      const raw = String(e?.message ?? e).split("\n")[0];
      const message = /parse error|bad magic|no variants/i.test(raw) ? `Bukan file log DJI yang valid atau file rusak (${raw.replace(/:$/, "")})` : raw;
      flights.push({ id: null, status: "error", log: rel, sha256, error: message });
      stats.failed++;
      log(`GAGAL  ${rel}: ${message}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning file=${rel}::${message}`);
    }
  }

  // Hapus hasil untuk log yang sudah dihapus dari logs/.
  const keep = new Set(flights.filter((f) => f.id).map((f) => f.id));
  for (const f of previous) {
    if (f.id && !keep.has(f.id) && existsSync(join(root, "flights", f.id))) {
      rmSync(join(root, "flights", f.id), { recursive: true, force: true });
      stats.removed++;
      log(`HAPUS  flights/${f.id} (log sumber sudah tidak ada)`);
    }
  }

  flights.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || a.log.localeCompare(b.log));
  // Waktu "generated" hanya berubah bila isinya berubah, agar tidak ada commit kosong.
  const unchanged = JSON.stringify(previous) === JSON.stringify(flights) && previousIndex.timezoneOffset === tz && previousIndex.timezoneName === config.timezoneName;
  const generated = unchanged && previousIndex.generated ? previousIndex.generated : new Date().toISOString();
  const index = { generated, timezoneOffset: tz, timezoneName: config.timezoneName, flights };
  mkdirSync(join(root, "flights"), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  const md = renderFlightsMarkdown(index);
  writeFileSync(join(root, "FLIGHTS.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  log(`Selesai: ${stats.processed} diproses, ${stats.skipped} sudah ada, ${stats.failed} gagal, ${stats.removed} dihapus.`);
  return { index, stats };
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.FLIGHT_SMART_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
  await processAll({ root, force: process.argv.includes("--force") });
}
