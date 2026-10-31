import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processAll } from "../scripts/process-logs.mjs";
import { fakeFrames, fakeParserFactory } from "./helpers.mjs";
import { extractTrack } from "../scripts/lib/track.mjs";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "fsmart-"));
  mkdirSync(join(root, "logs"));
  writeFileSync(join(root, "flight-smart.config.json"), JSON.stringify({ timezoneOffset: "+08:00", timezoneName: "WITA", trackIntervalSeconds: 1 }));
  return root;
}

const specs = {
  A: { startMs: Date.UTC(2026, 9, 26, 1, 0, 0), seconds: 120 },
  B: { startMs: Date.UTC(2026, 9, 26, 2, 30, 0), seconds: 60, photoEvery: 0 },
  ENC: { startMs: Date.UTC(2026, 9, 27, 0, 0, 0), seconds: 30, version: 14 },
};
const quiet = () => {};

test("memproses log menjadi GPX/KML/GeoJSON/CSV/track.json dan indeks", async () => {
  const root = setup();
  writeFileSync(join(root, "logs", "DJIFlightRecord_2026-10-26_[09-00-00].txt"), "A");
  writeFileSync(join(root, "logs", "DJIFlightRecord_2026-10-26_[10-30-00].txt"), "B");
  writeFileSync(join(root, "logs", "rusak.txt"), "???");
  const { index, stats } = await processAll({ root, createParser: fakeParserFactory(specs), log: quiet });
  assert.equal(stats.processed, 2);
  assert.equal(stats.failed, 1);
  const ok = index.flights.filter((f) => f.status === "ok");
  assert.deepEqual(ok.map((f) => f.id), ["2026-10-26_103000", "2026-10-26_090000"]);
  const a = ok[1];
  assert.equal(a.startLocal, "2026-10-26T09:00:00");
  assert.equal(a.photos, 5); // t = 20, 40, 60, 80, 100
  assert.ok(a.distanceM > 100 && a.distanceM < 1000, `jarak ${a.distanceM}`);
  for (const p of Object.values(a.files)) assert.ok(existsSync(join(root, p)), p);
  const gpx = readFileSync(join(root, a.files.gpx), "utf8");
  assert.match(gpx, /<trkpt lat="-8\.28649000" lon="118\.1738075/);
  assert.match(gpx, /<time>2026-10-26T01:00:00\.500Z<\/time>/);
  const geo = JSON.parse(readFileSync(join(root, a.files.geojson), "utf8"));
  assert.equal(geo.features[0].geometry.type, "LineString");
  const trk = JSON.parse(readFileSync(join(root, a.files.track), "utf8"));
  assert.equal(trk.photos.length, 5);
  assert.ok(trk.points.length > 100 && trk.points.length < 130, `titik ${trk.points.length}`);
  const csv = readFileSync(join(root, a.files.csv), "utf8").split("\n");
  assert.equal(csv.length, 1200 + 2);
  const md = readFileSync(join(root, "FLIGHTS.md"), "utf8");
  assert.match(md, /\*\*2 penerbangan\*\*/);
  assert.match(md, /## Gagal diproses/);
  assert.match(md, /DJIFlightRecord_2026-10-26_%5B09-00-00%5D\.txt|DJIFlightRecord_2026-10-26_\[09-00-00\]\.txt/);
  rmSync(root, { recursive: true, force: true });
});

test("melewati log yang sudah diproses dan menghapus hasil untuk log yang dihapus", async () => {
  const root = setup();
  writeFileSync(join(root, "logs", "a.txt"), "A");
  writeFileSync(join(root, "logs", "b.txt"), "B");
  await processAll({ root, createParser: fakeParserFactory(specs), log: quiet });
  rmSync(join(root, "logs", "b.txt"));
  const { index, stats } = await processAll({ root, createParser: fakeParserFactory(specs), log: quiet });
  assert.equal(stats.skipped, 1);
  assert.equal(stats.removed, 1);
  assert.equal(index.flights.length, 1);
  assert.ok(!existsSync(join(root, "flights", "2026-10-26_103000")));
  rmSync(root, { recursive: true, force: true });
});

test("log versi 13+ butuh DJI_API_KEY, lalu berhasil setelah key ada", async () => {
  const root = setup();
  writeFileSync(join(root, "logs", "enc.txt"), "ENC");
  let r = await processAll({ root, apiKey: "", createParser: fakeParserFactory(specs), log: quiet });
  assert.equal(r.index.flights[0].status, "error");
  assert.match(r.index.flights[0].error, /DJI_API_KEY/);
  r = await processAll({ root, apiKey: "good-key", createParser: fakeParserFactory(specs), log: quiet });
  assert.equal(r.index.flights[0].status, "ok");
  assert.equal(r.index.flights[0].version, 14);
  rmSync(root, { recursive: true, force: true });
});

test("ketinggian MSL 0 di awal track (home belum tercatat) diisi dari ketinggian home", () => {
  const frames = fakeFrames({ seconds: 5 });
  for (let i = 5; i < 10; i++) frames[i].osd.altitude = 0;
  const pts = extractTrack(frames, { intervalSec: 1 });
  assert.equal(pts[0].alt, 241);
  assert.ok(pts.every((p) => p.alt > 0));
});
