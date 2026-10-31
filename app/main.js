// Flight SMART: aplikasi web untuk daftar penerbangan drone, sinkron log DJI ke GitHub,
// dan pengisian data foto drone sesuai model SMART (ekspor JSON SMART Mobile).

import { $, h, clear, store, parseOffset, toast } from "./ui.js";
import { GitHubRepo } from "./github.js";
import { parseConfigurableModel, parsePatrolMetadata } from "./smart.js";
import { renderFlights } from "./view-flights.js";
import { renderSync } from "./view-sync.js";
import { renderSmart } from "./view-smart.js";
import { renderSettings } from "./view-settings.js";

const EMBED = window.__FLIGHT_SMART__ ?? {};

function defaultRepo() {
  const host = location.hostname.match(/^([^.]+)\.github\.io$/);
  const seg = location.pathname.split("/").filter(Boolean)[0];
  if (host && seg) return { owner: host[1], repo: seg, branch: "main" };
  return { owner: "kopluck8", repo: "Flight_SMART", branch: "main" };
}

function randomDeviceId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("") + "0".repeat(16);
}

const settings = {
  ...defaultRepo(),
  token: "",
  tz: "+08:00",
  trackInterval: 5,
  photoMax: 1600,
  photoQuality: 0.85,
  ...store.get("fs.settings", {}),
};
if (!settings.deviceId) settings.deviceId = randomDeviceId();

export const ctx = {
  settings,
  index: null,
  indexError: null,
  tracks: new Map(),
  smart: null,
  saveSettings() {
    store.set("fs.settings", settings);
  },
  get tzMin() {
    return parseOffset(settings.tz);
  },
  repo() {
    return new GitHubRepo({ owner: settings.owner, repo: settings.repo, branch: settings.branch, token: settings.token });
  },
  /** Baca file dari repo. Dengan token lewat API (selalu terbaru, bisa repo private);
   *  tanpa token dari raw.githubusercontent.com (repo public, tanpa batas 60 permintaan/jam). */
  async fetchFile(path, as = "json") {
    let buf;
    if (!settings.token) {
      try {
        const url = `https://raw.githubusercontent.com/${settings.owner}/${settings.repo}/${encodeURIComponent(settings.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
        const r = await fetch(url, { cache: "no-cache" });
        if (r.ok) buf = await r.arrayBuffer();
      } catch {}
    }
    buf ??= await this.repo().readFile(path);
    if (as === "blob") return new Blob([buf]);
    const text = new TextDecoder().decode(buf);
    return as === "json" ? JSON.parse(text) : text;
  },
  async loadIndex(force = false) {
    if (this.index && !force) return this.index;
    try {
      this.index = await this.fetchFile("flights/index.json");
      this.indexError = null;
    } catch (e) {
      this.index = { flights: [] };
      this.indexError = e.status === 404 ? "Belum ada data penerbangan di repo." : e.message;
    }
    return this.index;
  },
  /** Titik track penerbangan: [{ms, lat, lon, alt, height, acc}] */
  async loadTrack(flight) {
    if (this.tracks.has(flight.id)) return this.tracks.get(flight.id);
    const t = await this.fetchFile(flight.files.track);
    const pts = t.points
      .filter((p) => p[0] !== null)
      .map(([dt, lon, lat, alt, height, , sats]) => ({ ms: t.t0 + dt * 1000, lon, lat, alt, height, acc: sats >= 12 ? 1.5 : sats >= 8 ? 3 : 6 }));
    const photos = (t.photos ?? []).map(([dt, lon, lat, alt, height, pitch, yaw]) => ({ ms: t.t0 + dt * 1000, lon, lat, alt, height, pitch, yaw }));
    const res = { points: pts, photos };
    this.tracks.set(flight.id, res);
    return res;
  },
  loadSmart() {
    const custom = store.get("fs.smart", null);
    let model, metaRaw, project, source;
    try {
      if (custom?.cmXml) {
        model = parseConfigurableModel(custom.cmXml);
        source = "custom";
      }
    } catch (e) {
      toast(`Model SMART tersimpan rusak, memakai bawaan: ${e.message}`, "error");
    }
    if (!model) {
      model = EMBED.smart?.model;
      source = "bawaan";
    }
    metaRaw = custom?.metadata ?? EMBED.smart?.metadata ?? [];
    project = custom?.project ?? EMBED.smart?.project ?? {};
    const metadata = parsePatrolMetadata(metaRaw);
    this.smart = { model, metadata, project, source, metadataSource: custom?.metadata ? "custom" : "bawaan" };
    return this.smart;
  },
};

const TABS = [
  { id: "penerbangan", label: "Penerbangan", render: renderFlights },
  { id: "sinkron", label: "Sinkron", extra: " log", render: renderSync },
  { id: "smart", label: "Foto → SMART", render: renderSmart },
  { id: "pengaturan", label: "Pengaturan", render: renderSettings },
];

const views = {};

function show(id) {
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  for (const t of TABS) {
    $(`#tab-${t.id}`).setAttribute("aria-selected", String(t.id === tab.id));
    $(`#view-${t.id}`).hidden = t.id !== tab.id;
  }
  if (!views[tab.id]) {
    views[tab.id] = true;
    tab.render($(`#view-${tab.id}`), ctx);
  }
  document.dispatchEvent(new CustomEvent("fs:show", { detail: tab.id }));
  if (location.hash.slice(1) !== tab.id) history.replaceState(null, "", `#${tab.id}`);
}

export function goTo(id) {
  show(id);
  window.scrollTo({ top: 0 });
}

export function rerender(id) {
  delete views[id];
  const el = $(`#view-${id}`);
  clear(el);
  if (!el.hidden) show(id);
}

function boot() {
  ctx.loadSmart();
  const nav = $("#tabs");
  for (const t of TABS) {
    nav.append(h("button", { id: `tab-${t.id}`, role: "tab", "aria-controls": `view-${t.id}`, onClick: () => goTo(t.id) }, t.label, t.extra ? h("span", { class: "tab-extra" }, t.extra) : null));
    $("#views").append(h("section", { id: `view-${t.id}`, role: "tabpanel", "aria-labelledby": `tab-${t.id}`, hidden: true }));
  }
  const repoLink = $("#repo-link");
  repoLink.href = `https://github.com/${settings.owner}/${settings.repo}`;
  repoLink.textContent = `${settings.owner}/${settings.repo}`;
  show(location.hash.slice(1));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
}

boot();
