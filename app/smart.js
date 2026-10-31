// Model data SMART (Configurable Model + metadata patroli) dan pembuat file JSON
// berformat SMART Mobile (SMDATA_*.json) yang bisa diimpor SMART Desktop lewat
// Field Data → SMART Mobile → Import… → Import From: Files.

const elementName = (n) => n.localName || String(n.nodeName).split(":").pop();
const kids = (el, name) => Array.from(el?.childNodes ?? []).filter((n) => n.nodeType === 1 && elementName(n) === name);

function nameOf(el, lang) {
  const names = kids(el, "name");
  const n = names.find((x) => x.getAttribute("language_code") === lang) ?? names[0];
  return n ? n.getAttribute("value") ?? "" : "";
}

function optionsOf(attrEl) {
  const o = {};
  for (const x of kids(attrEl, "option")) {
    o[x.getAttribute("id")] = x.hasAttribute("doubleValue") ? Number(x.getAttribute("doubleValue")) : x.getAttribute("stringValue");
  }
  return o;
}

/** Membaca XML Configurable Model SMART (cm_model.xml / ekspor Configurable Model). */
export function parseConfigurableModel(xml, domParser = new DOMParser()) {
  const doc = domParser.parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || elementName(root) !== "ConfigurableModel") throw new Error("File ini bukan Configurable Model SMART.");
  const langs = kids(kids(root, "languages")[0], "language").map((l) => ({ code: l.getAttribute("code"), isDefault: l.getAttribute("is_default") === "true" }));
  const lang = (langs.find((l) => l.isDefault) ?? langs[0] ?? { code: "en" }).code;

  const configs = {};
  for (const c of kids(root, "attributeConfig")) {
    const walk = (el, parentActive) => {
      const active = parentActive && el.getAttribute("isActive") !== "false";
      return {
        key: el.getAttribute("keyRef"),
        hkey: el.getAttribute("hkeyRef"),
        uuid: el.getAttribute("dmUuid"),
        name: nameOf(el, lang),
        active,
        children: kids(el, "children").map((ch) => walk(ch, active)),
      };
    };
    configs[c.getAttribute("id")] = {
      id: c.getAttribute("id"),
      attributeKey: c.getAttribute("attributeKey"),
      list: kids(c, "listItem").map((li) => ({ key: li.getAttribute("keyRef"), uuid: li.getAttribute("dmUuid"), name: nameOf(li, lang), active: li.getAttribute("isActive") !== "false" })),
      tree: kids(c, "treeNode").map((tn) => walk(tn, true)),
    };
  }

  const parseNode = (el, path) => {
    const node = {
      id: el.getAttribute("id"),
      name: nameOf(el, lang),
      image: el.getAttribute("isCustomImage") === "true" ? el.getAttribute("imageFile") : null,
      categoryKey: el.getAttribute("categoryKey") || null,
      categoryHkey: el.getAttribute("categoryHkey") || null,
      categoryUuid: el.getAttribute("dmUuid") || null,
      photoAllowed: el.getAttribute("photoAllowed") === "true",
      photoRequired: el.getAttribute("photoRequired") === "true",
      path,
      attributes: kids(el, "attribute").map((a) => {
        const o = optionsOf(a);
        return {
          key: a.getAttribute("attributeKey"),
          uuid: a.getAttribute("dmUuid"),
          type: a.getAttribute("type"),
          required: a.getAttribute("required") === "true",
          name: nameOf(a, lang),
          configId: a.getAttribute("configId") || null,
          visible: o.IS_VISIBLE !== 0,
          multiselect: o.MULTISELECT === 1,
        };
      }),
      children: [],
    };
    node.children = kids(el, "node").map((ch) => parseNode(ch, [...path, node.name]));
    return node;
  };
  const nodes = kids(kids(root, "nodes")[0], "node").map((n) => parseNode(n, []));

  let profile = "";
  for (const x of kids(root, "extraData")) {
    if (x.getAttribute("type") !== "ct_profile") continue;
    for (const lk of kids(x, "labelKey")) {
      const label = kids(lk, "label").find((l) => l.getAttribute("language_code") === lang) ?? kids(lk, "label")[0];
      if (lk.getAttribute("key") === "name" && label) profile = label.getAttribute("value");
    }
  }
  return { name: nameOf(root, lang), lang, profile, nodes, configs };
}

/** Semua node kategori (yang bisa dipilih untuk observasi), urut seperti di SMART Mobile. */
export function categoryNodes(model) {
  const out = [];
  const walk = (n) => {
    if (n.categoryUuid) out.push(n);
    n.children.forEach(walk);
  };
  model.nodes.forEach(walk);
  return out;
}

export function findNode(model, id) {
  let found = null;
  const walk = (n) => {
    if (n.id === id) found = n;
    else n.children.forEach(walk);
  };
  model.nodes.forEach(walk);
  return found;
}

/** Pilihan daun untuk atribut TREE: [{uuid, name, path}] (hanya yang aktif). */
export function treeLeaves(config) {
  const out = [];
  const walk = (n, trail) => {
    if (!n.active) return;
    const t = [...trail, n.name];
    if (n.children.length) n.children.forEach((c) => walk(c, t));
    else out.push({ uuid: n.uuid, name: n.name, path: t });
  };
  (config?.tree ?? []).forEach((n) => walk(n, []));
  return out;
}

export function listOptions(config) {
  return (config?.list ?? []).filter((o) => o.active);
}

/** Metadata patroli dari paket SMART Mobile (patrol_metadata.json). */
export function parsePatrolMetadata(arr) {
  const f = Object.assign({}, ...(Array.isArray(arr) ? arr : [arr]));
  const label = (x) => x?.label_in || x?.label_default || x?.label_en || x?.label || "";
  const opts = (field) => (f[field]?.options ?? []).map((o) => ({ uuid: o.uuid, key: o.key ?? null, name: label(o) }));
  const field = (id) => ({ id, name: label(f[id]), required: Boolean(f[id]?.isRequired), visible: f[id]?.isVisible !== false });
  return {
    cmUuid: f.SMART_cmUuid?.default ?? null,
    fields: {
      transport: field("SMART_PatrolTransport"),
      armed: field("SMART_Armed"),
      team: field("SMART_Team"),
      station: field("SMART_Station"),
      mandate: field("SMART_Mandate"),
      objective: field("SMART_Objective"),
      comment: field("SMART_Comments"),
      members: field("SMART_Employees"),
      leader: field("SMART_Leader"),
      pilot: { ...field("SMART_Pilot"), name: label(f.SMART_Pilot) || "Pilot" },
    },
    transport: opts("SMART_PatrolTransport"),
    teams: opts("SMART_Team"),
    stations: opts("SMART_Station"),
    mandates: opts("SMART_Mandate"),
    employees: (f.SMART_Employees?.options ?? []).map((o) => ({ uuid: o.uuid, name: o.label ?? label(o) })),
    employeeGroups: (f.SMART_Employees?.groups ?? []).map((g) => ({ name: label(g), members: g.options ?? [] })),
    pilotRequiredFor: f.SMART_Pilot?.required_by?.SMART_PatrolTransport ?? [],
    custom: Object.entries(f)
      .filter(([k]) => /^SMART_[0-9a-f]{32}$/.test(k))
      .map(([k, v]) => ({
        id: k,
        name: label(v),
        type: v.type,
        required: Boolean(v.isRequired),
        visible: v.isVisible !== false,
        options: (v.options ?? []).map((o) => ({ uuid: o.uuid, key: o.key ?? null, name: label(o) })),
      })),
  };
}

// ---------------------------------------------------------------- waktu & geometri

const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");

/** 1730000000000, 480 -> "2026-10-26T15:30:44.017+08:00" */
export function smartDateTime(ms, tzMin) {
  const d = new Date(ms + tzMin * 60000);
  const sign = tzMin < 0 ? "-" : "+";
  return `${d.toISOString().slice(0, 23)}${sign}${pad(Math.abs(tzMin) / 60)}:${pad(Math.abs(tzMin) % 60)}`;
}

function localParts(ms, tzMin) {
  const iso = new Date(ms + tzMin * 60000).toISOString();
  return { date: iso.slice(0, 10).replace(/-/g, "/"), time: iso.slice(11, 19), stamp: iso.slice(0, 23) };
}

export function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Posisi pada track di waktu ms (interpolasi linear), atau null bila di luar rentang. */
export function positionAt(points, ms) {
  if (!points.length || ms < points[0].ms || ms > points[points.length - 1].ms) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ms <= ms) lo = mid;
    else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const k = b.ms === a.ms ? 0 : (ms - a.ms) / (b.ms - a.ms);
  return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, alt: (a.alt ?? 0) + ((b.alt ?? 0) - (a.alt ?? 0)) * k };
}

export const newUuid = () =>
  (globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  })).replace(/-/g, "");

/** Nilai atribut dalam format sighting SMART Mobile. */
export function encodeValue(type, value) {
  if (value === null || value === undefined || value === "") return undefined;
  switch (type) {
    case "LIST":
      return `l:${value}`;
    case "TREE":
      return `t:${value}`;
    case "NUMERIC": {
      const n = Number(String(value).replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    }
    case "BOOLEAN":
      return value === true || value === "true";
    case "DATE":
      return String(value).replace(/-/g, "/");
    default:
      return String(value);
  }
}

/** Atribut wajib yang belum diisi untuk satu observasi. */
export function missingRequired(node, values = {}) {
  return node.attributes.filter((a) => a.visible && a.required && encodeValue(a.type, values[a.uuid]) === undefined).map((a) => a.name);
}

// ---------------------------------------------------------------- ekspor SMDATA

/**
 * Membuat FeatureCollection seperti yang diekspor SMART Mobile untuk satu patroli.
 *
 * segments: [{ points: [{ms, lat, lon, alt, acc}] }]  satu segmen per penerbangan
 * observations: [{ ms, lat, lon, alt, node, values: {attrUuid: value}, photos: [base64Jpeg] }]
 * patrol: { transport, team, station, mandate, objective, comment, leader, pilot, members: [], armed, custom: {SMART_<uuid>: value} }
 */
export function buildSmdata({
  patrol,
  segments = [],
  observations = [],
  cmUuid,
  tzMin = 480,
  trackIntervalSec = 5,
  deviceId,
  appName = "",
  ctVersion = "1.0.615",
  exportedAt = Date.now(),
  newId = newUuid,
}) {
  const warnings = [];
  const obs = observations.filter((o) => Number.isFinite(o.ms) && Number.isFinite(o.lat) && Number.isFinite(o.lon)).sort((a, b) => a.ms - b.ms);
  if (obs.length !== observations.length) warnings.push(`${observations.length - obs.length} foto dilewati karena tidak punya waktu atau lokasi.`);

  let segs = segments
    .map((s) => ({ points: [...s.points].filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms) }))
    .filter((s) => s.points.length)
    .sort((a, b) => a.points[0].ms - b.points[0].ms);

  if (!segs.length) {
    if (!obs.length) throw new Error("Tidak ada track penerbangan maupun foto untuk dijadikan patroli.");
    segs = [{ points: obs.map((o) => ({ ms: o.ms, lat: o.lat, lon: o.lon, alt: o.alt, acc: 5 })) }];
    warnings.push("Tidak ada log penerbangan dipilih, jadi track patroli dibuat dari lokasi foto.");
  }

  // Masukkan setiap foto ke segmen yang rentang waktunya memuat foto tsb (atau yang terdekat).
  for (const s of segs) {
    s.start = s.points[0].ms;
    s.end = s.points[s.points.length - 1].ms;
    s.obs = [];
  }
  let outside = 0;
  for (const o of obs) {
    let best = segs.find((s) => o.ms >= s.start && o.ms <= s.end);
    if (!best) {
      outside++;
      best = segs.reduce((a, s) => (Math.min(Math.abs(o.ms - s.start), Math.abs(o.ms - s.end)) < Math.min(Math.abs(o.ms - a.start), Math.abs(o.ms - a.end)) ? s : a));
    }
    best.obs.push(o);
  }
  if (outside) warnings.push(`${outside} foto diambil di luar waktu penerbangan yang dipilih; foto tersebut dimasukkan ke penerbangan terdekat.`);

  // Jarak kumulatif sepanjang track (berlanjut antar segmen, tidak dihitung saat jeda).
  let carried = 0;
  for (const s of segs) {
    s.dist = [carried];
    for (let i = 1; i < s.points.length; i++) s.dist.push(s.dist[i - 1] + haversine(s.points[i - 1], s.points[i]));
    s.carried = carried;
    carried = s.dist[s.dist.length - 1];
  }
  const distanceAt = (s, ms) => {
    let i = 0;
    while (i + 1 < s.points.length && s.points[i + 1].ms <= ms) i++;
    return ms < s.points[0].ms ? s.carried : s.dist[i];
  };

  const first = segs[0];
  const patrolStartMs = Math.min(first.start, ...first.obs.map((o) => o.ms));
  const start = localParts(patrolStartMs, tzMin);
  const patrolId = newId();
  const members = new Set(patrol.members ?? []);
  if (patrol.leader) members.add(patrol.leader);
  if (patrol.pilot) members.add(patrol.pilot);

  const common = {};
  for (const [k, v] of Object.entries(patrol.custom ?? {})) if (v !== undefined && v !== null && v !== "") common[k] = v;
  common.SMART_Armed = Boolean(patrol.armed);
  if (patrol.comment) common.SMART_Comments = patrol.comment;
  common.SMART_DataType = "patrol";
  common.SMART_DefaultAttributeValues = "{}";
  common.SMART_DefaultPatrolValues = "{}";
  if (patrol.leader) common.SMART_Leader = `e:${patrol.leader}`;
  if (patrol.mandate) common.SMART_Mandate = `pm:${patrol.mandate}`;
  common.SMART_NewWaypoint = true;
  if (patrol.objective) common.SMART_Objective = patrol.objective;
  common.SMART_PatrolID = patrolId;
  common.SMART_PatrolLegCounter = 1;
  common.SMART_PatrolStartDate = start.date;
  common.SMART_PatrolStartTime = start.time;
  if (patrol.transport) common.SMART_PatrolTransport = `tt:${patrol.transport}`;
  if (patrol.pilot) common.SMART_Pilot = `e:${patrol.pilot}`;
  if (patrol.station) common.SMART_Station = `ps:${patrol.station}`;
  if (patrol.team) common.SMART_Team = `pt:${patrol.team}`;
  if (cmUuid) common.SMART_cmUuid = cmUuid;
  const memberFlags = Object.fromEntries([...members].map((m) => [`e:${m}`, true]));

  const features = [];
  let counter = 0;
  const point = (lon, lat) => ({ coordinates: [lon, lat], type: "Point" });

  const sighting = (type, at, distance, extra = {}, sameRoot = true) => {
    counter++;
    const id = newId();
    const sightingProps = {
      ...common,
      SMART_ObsCounter: counter,
      SMART_ObservationType: type,
      SMART_PatrolLegDistance: distance,
      ...extra,
      ...memberFlags,
    };
    features.push({
      geometry: point(at.lon, at.lat),
      properties: {
        altitude: at.alt ?? 0,
        appName,
        ctVersion,
        dateTime: smartDateTime(at.ms, tzMin),
        deviceId,
        id,
        latitude: at.lat,
        longitude: at.lon,
        rootId: sameRoot ? id : newId(),
        sighting: sortKeys(sightingProps),
      },
      type: "Feature",
    });
  };

  let photoCount = 0;
  segs.forEach((s, si) => {
    const startMs = Math.min(s.start, ...s.obs.map((o) => o.ms));
    const endMs = Math.max(s.end, ...s.obs.map((o) => o.ms));
    const startAt = startMs < s.start ? s.obs[0] : s.points[0];
    const endAt = endMs > s.end ? s.obs[s.obs.length - 1] : s.points[s.points.length - 1];

    sighting(si === 0 ? "NewPatrol" : "ResumePatrol", { ...startAt, ms: startMs }, s.carried);

    for (const o of s.obs) {
      const extra = { SMART_SightingGroupId: newId(), "c:0": o.node.categoryUuid };
      (o.photos ?? []).forEach((b64, i) => {
        extra[`SMART_Photo${i}:0`] = b64;
        photoCount++;
      });
      for (const a of o.node.attributes) {
        if (!a.visible) continue;
        const v = encodeValue(a.type, o.values?.[a.uuid]);
        if (v !== undefined) extra[`a:0:${a.uuid}`] = v;
      }
      sighting("Observation", o, distanceAt(s, o.ms), extra, false);
    }

    let lastKept = -Infinity;
    s.points.forEach((p, i) => {
      const isLast = i === s.points.length - 1;
      if (p.ms - lastKept < trackIntervalSec * 1000 && !isLast) return;
      lastKept = p.ms;
      features.push({
        geometry: point(p.lon, p.lat),
        properties: {
          SMART_ObservationType: "waypoint",
          accuracy: p.acc ?? 3,
          altitude: p.alt ?? 0,
          dateTime: smartDateTime(p.ms, tzMin),
          deviceId,
          id: newId(),
        },
        type: "Feature",
      });
    });

    sighting(si === segs.length - 1 ? "StopPatrol" : "PausePatrol", { ...endAt, ms: endMs }, s.dist[s.dist.length - 1]);
  });

  const filename = `SMDATA_${localParts(exportedAt, tzMin).stamp.replace(/[:.]/g, "_")}_Patrol-0001.json`;
  return {
    filename,
    data: { type: "FeatureCollection", features },
    warnings,
    summary: {
      patrolId,
      start: smartDateTime(patrolStartMs, tzMin),
      segments: segs.length,
      observations: obs.length,
      photos: photoCount,
      trackPoints: features.filter((f) => f.properties.SMART_ObservationType === "waypoint").length,
      distanceM: Math.round(carried),
    },
  };
}

function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
