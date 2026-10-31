import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { parseConfigurableModel, categoryNodes, parsePatrolMetadata, treeLeaves, listOptions, buildSmdata, smartDateTime, missingRequired, positionAt } from "../app/smart.js";

const cm = parseConfigurableModel(readFileSync(new URL("../data/smart/cm_model.xml", import.meta.url), "utf8"), new DOMParser());
const meta = parsePatrolMetadata(JSON.parse(readFileSync(new URL("../data/smart/patrol_metadata.public.json", import.meta.url), "utf8")));

test("membaca Configurable Model TN Tambora", () => {
  assert.equal(cm.name, "SMART TN TAMBORA 2026");
  assert.equal(cm.profile, "SMART Patrol");
  const cats = categoryNodes(cm);
  assert.equal(cats.length, 30);
  const pal = cats.find((c) => c.categoryHkey === "fitur.palbatas.");
  assert.equal(pal.categoryUuid, "a3dd34c476954cc9bac9d25b9482b42d");
  assert.deepEqual(pal.path, ["Fitur"]);
  const tipe = pal.attributes.find((a) => a.key === "tipetemuan");
  assert.equal(tipe.type, "TREE");
  assert.ok(treeLeaves(cm.configs[tipe.configId]).length > 0);
  const kondisi = pal.attributes.find((a) => a.key === "kondisi");
  assert.ok(listOptions(cm.configs[kondisi.configId]).some((o) => o.uuid === "f846ea52af57464b970d4ec99bd162e4"));
  assert.equal(pal.attributes.find((a) => a.key === "tanggaltindaklanjut").visible, false);
});

test("membaca metadata patroli", () => {
  assert.equal(meta.cmUuid, "e3b5c542edb44c179bf7e3626994aa7b");
  const drone = meta.transport.find((t) => t.key === "drone");
  assert.equal(drone.uuid, "558af845835046efa7a06e553a8e3637");
  assert.deepEqual(meta.pilotRequiredFor, ["558af845835046efa7a06e553a8e3637"]);
  assert.equal(meta.custom.length, 2);
  assert.equal(meta.employees.length, 0); // versi publik tanpa nama petugas
});

test("format waktu SMART", () => {
  assert.equal(smartDateTime(Date.UTC(2026, 9, 26, 7, 30, 44, 17), 480), "2026-10-26T15:30:44.017+08:00");
  assert.equal(smartDateTime(Date.UTC(2026, 9, 26, 7, 30, 44, 17), -330), "2026-10-26T02:00:44.017-05:30");
});

test("interpolasi posisi pada track", () => {
  const pts = [{ ms: 0, lat: 0, lon: 0, alt: 0 }, { ms: 10, lat: 1, lon: 2, alt: 10 }];
  assert.deepEqual(positionAt(pts, 5), { lat: 0.5, lon: 1, alt: 5 });
  assert.equal(positionAt(pts, 11), null);
});

function sample() {
  const cats = categoryNodes(cm);
  const pal = cats.find((c) => c.categoryHkey === "fitur.palbatas.");
  const val = (key) => pal.attributes.find((a) => a.key === key);
  const t0 = Date.UTC(2026, 9, 26, 1, 0, 0);
  const seg = (start, n) => ({ points: Array.from({ length: n }, (_, i) => ({ ms: start + i * 1000, lat: -8.28 + i * 1e-5, lon: 118.17, alt: 300, acc: 2 })) });
  let k = 0;
  const ids = () => (++k).toString(16).padStart(32, "0");
  return buildSmdata({
    patrol: {
      transport: "558af845835046efa7a06e553a8e3637", team: "6b9ae082384e4fdb814f74057593ea32", station: "28c6b5089e82461fb5d8b8797c8374d0",
      mandate: "22fd9f418bb34288a53d7b7a83e9483d", objective: "Patroli drone", leader: "aaaa", pilot: "bbbb", members: ["cccc"], armed: false,
      custom: { SMART_053e32927149421e9eec6034ca70eb98: "91d5501147474564b7a52886ccdabe4f", SMART_46c472091b17430ea75170be0b52423f: "ST 1" },
    },
    segments: [seg(t0, 60), seg(t0 + 3600_000, 30)],
    observations: [
      { ms: t0 + 20_000, lat: -8.2798, lon: 118.17, alt: 310, node: pal, values: { [val("tipetemuan").uuid]: treeLeaves(cm.configs[val("tipetemuan").configId])[0].uuid, [val("kondisi").uuid]: "f846ea52af57464b970d4ec99bd162e4", [val("perlutindaklanjut").uuid]: "b34d8749c7994741a9d7d15edeb0771f", [val("nopal").uuid]: "308" }, photos: ["AAAA", "BBBB"] },
      { ms: t0 + 3600_000 + 10_000, lat: -8.2799, lon: 118.17, alt: 310, node: pal, values: {}, photos: [] },
    ],
    cmUuid: meta.cmUuid,
    tzMin: 480,
    trackIntervalSec: 15,
    deviceId: "7f4660a71628e50c0000000000000000",
    appName: "SMART TN Tambora/2026-V1",
    exportedAt: Date.UTC(2026, 9, 26, 6, 59, 44, 545),
    newId: ids,
  });
}

test("SMDATA mengikuti struktur ekspor SMART Mobile", () => {
  const out = sample();
  assert.equal(out.filename, "SMDATA_2026-10-26T14_59_44_545_Patrol-0001.json");
  const f = out.data.features;
  const types = f.map((x) => x.properties.sighting?.SMART_ObservationType ?? "trk");
  assert.deepEqual(types.filter((t) => t !== "trk"), ["NewPatrol", "Observation", "PausePatrol", "ResumePatrol", "Observation", "StopPatrol"]);
  // urutan per segmen: awal, observasi, track, akhir
  assert.deepEqual(types.slice(0, 3), ["NewPatrol", "Observation", "trk"]);
  const first = f[0].properties;
  assert.equal(first.dateTime, "2026-10-26T09:00:00.000+08:00");
  assert.equal(first.sighting.SMART_PatrolStartDate, "2026/10/26");
  assert.equal(first.sighting.SMART_PatrolStartTime, "09:00:00");
  assert.equal(first.sighting.SMART_PatrolTransport, "tt:558af845835046efa7a06e553a8e3637");
  assert.equal(first.sighting.SMART_Pilot, "e:bbbb");
  assert.equal(first.sighting["e:aaaa"], true);
  assert.equal(first.sighting["e:cccc"], true);
  assert.equal(first.id, first.rootId);
  const obs = f[1].properties;
  assert.notEqual(obs.id, obs.rootId);
  assert.equal(obs.sighting["c:0"], "a3dd34c476954cc9bac9d25b9482b42d");
  assert.equal(obs.sighting["SMART_Photo0:0"], "AAAA");
  assert.equal(obs.sighting["SMART_Photo1:0"], "BBBB");
  assert.match(obs.sighting["a:0:1b80154486884b71b8d419e7628fbcf5"] ?? Object.entries(obs.sighting).find(([k]) => k.startsWith("a:0:"))[1], /^[tl]:|^\d/);
  assert.equal(obs.sighting["a:0:49d753924e9c40efbe59b1a37d151ac0"], "308");
  assert.ok(Object.values(obs.sighting).includes("l:f846ea52af57464b970d4ec99bd162e4"));
  assert.equal(obs.sighting.SMART_ObsCounter, 2);
  const trk = f.filter((x) => !x.properties.sighting);
  assert.deepEqual(Object.keys(trk[0].properties).sort(), ["SMART_ObservationType", "accuracy", "altitude", "dateTime", "deviceId", "id"]);
  assert.equal(out.summary.trackPoints, 4 + 1 + 2 + 1); // 60 titik/15 dtk = 0,15,30,45 + terakhir; 30 titik = 0,15 + terakhir
  const stop = f[f.length - 1].properties.sighting;
  assert.equal(stop.SMART_ObservationType, "StopPatrol");
  assert.ok(stop.SMART_PatrolLegDistance > 0);
  assert.equal(stop.SMART_ObsCounter, 6);
});

test("struktur kunci sama dengan contoh ekspor SMART Mobile asli (bila tersedia)", (t) => {
  let real;
  try {
    real = JSON.parse(readFileSync(process.env.SMDATA_SAMPLE ?? "", "utf8"));
  } catch {
    t.skip("set SMDATA_SAMPLE untuk membandingkan dengan file asli");
    return;
  }
  const norm = (k) => k.replace(/^(a:\d+:|e:|SMART_Photo\d+:)[0-9a-f:]*$/, "$1*").replace(/^SMART_[0-9a-f]{32}$/, "SMART_<custom>");
  const keysOf = (fc, type) => {
    const s = new Set(), p = new Set();
    for (const f of fc.features) {
      const st = f.properties.sighting?.SMART_ObservationType ?? "trk";
      if (st !== type) continue;
      Object.keys(f.properties).forEach((k) => p.add(k));
      Object.keys(f.properties.sighting ?? {}).forEach((k) => s.add(norm(k)));
    }
    return { props: [...p].sort(), sighting: [...s].sort() };
  };
  const ours = sample().data;
  for (const type of ["NewPatrol", "Observation", "PausePatrol", "ResumePatrol", "StopPatrol", "trk"]) {
    const a = keysOf(real, type), b = keysOf(ours, type);
    assert.deepEqual(b.props, a.props, `${type}: properti`);
    // contoh asli tidak memakai pilot (patroli Roda 4) dan tidak punya komentar
    const ignore = new Set(["SMART_Pilot"]);
    assert.deepEqual(b.sighting.filter((k) => !ignore.has(k)), a.sighting.filter((k) => !ignore.has(k)), `${type}: sighting`);
  }
});

test("atribut wajib yang kosong terdeteksi", () => {
  const pal = categoryNodes(cm).find((c) => c.categoryHkey === "fitur.palbatas.");
  assert.deepEqual(missingRequired(pal, {}), ["Tipe temuan", "Perlu tindak lanjut"]);
});
