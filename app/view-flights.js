// Tab "Penerbangan": daftar penerbangan dari repo, peta jalur terbang, dan unduhan.

import { h, clear, fmtDuration, fmtDistance, fmtNum, fmtLocal, download, toast, store } from "./ui.js";
import { createMap } from "./map.js";
import { goTo } from "./main.js";

export function renderFlights(root, ctx) {
  const head = h("div", { class: "view-head" });
  const body = h("div", { class: "flights" });
  const list = h("div", { class: "flight-list", role: "list" });
  const detail = h("div", { class: "flight-detail" });
  body.append(list, detail);
  root.append(head, body);

  let mapApi = null;
  let selected = null;

  async function load(force) {
    clear(list, h("p", { class: "muted pad" }, "Memuat daftar penerbangan…"));
    const index = await ctx.loadIndex(force);
    const ok = index.flights.filter((f) => f.status === "ok");
    const failed = index.flights.filter((f) => f.status !== "ok");
    const totalSec = ok.reduce((a, f) => a + (f.durationSec || 0), 0);
    const totalM = ok.reduce((a, f) => a + (f.distanceM || 0), 0);
    clear(
      head,
      h("div", {},
        h("h2", {}, "Penerbangan"),
        h("p", { class: "muted" }, ok.length ? `${ok.length} penerbangan · ${fmtDuration(totalSec)} di udara · ${fmtDistance(totalM)}` : "Belum ada penerbangan.")
      ),
      h("div", { class: "row gap" },
        h("button", { class: "btn", onClick: () => load(true) }, "Muat ulang"),
        h("button", { class: "btn primary", onClick: () => goTo("sinkron") }, "Sinkron log baru")
      )
    );
    clear(list);
    if (ctx.indexError) list.append(h("div", { class: "notice" }, ctx.indexError, " ", h("a", { href: "#sinkron" }, "Unggah log pertama"), "."));
    for (const f of ok) list.append(card(f));
    if (failed.length) {
      list.append(h("h3", { class: "list-sub" }, `Gagal diproses (${failed.length})`));
      for (const f of failed) list.append(h("div", { class: "flight-card failed", role: "listitem" }, h("strong", {}, f.log.split("/").pop()), h("p", { class: "small" }, f.error)));
    }
    const want = ok.find((f) => f.id === selected) ?? ok[0];
    if (want) select(want);
    else clear(detail, h("div", { class: "empty" }, h("p", {}, "Setelah log diunggah ke folder logs/, GitHub Actions memprosesnya dalam ±1 menit dan penerbangan muncul di sini.")));
  }

  function card(f) {
    const tz = ctx.tzMin;
    const el = h(
      "button",
      { class: "flight-card", role: "listitem", "data-id": f.id, onClick: () => select(f) },
      h("span", { class: "fc-date" }, fmtLocal(Date.parse(f.start), tz)),
      h("span", { class: "fc-air" }, f.aircraft || "DJI"),
      h("span", { class: "fc-stats" }, `${fmtDuration(f.durationSec)} · ${fmtDistance(f.distanceM)} · ${fmtNum(f.maxHeightM)} m`),
      f.photos ? h("span", { class: "chip" }, `${f.photos} foto`) : null
    );
    return el;
  }

  async function select(f) {
    selected = f.id;
    for (const c of list.querySelectorAll(".flight-card")) c.classList.toggle("active", c.dataset.id === f.id);
    const tz = ctx.tzMin;
    const mapEl = h("div", { class: "map" });
    const dl = (label, path, name) =>
      h("button", {
        class: "btn",
        onClick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            download(name, await ctx.fetchFile(path, "blob"));
          } catch (err) {
            toast(err.message, "error");
          } finally {
            btn.disabled = false;
          }
        },
      }, label);
    const gh = `https://github.com/${ctx.settings.owner}/${ctx.settings.repo}/blob/${ctx.settings.branch}/`;
    clear(
      detail,
      h("div", { class: "detail-head" },
        h("div", {},
          h("h3", {}, fmtLocal(Date.parse(f.start), tz, { seconds: false })),
          h("p", { class: "muted" }, [f.aircraft, f.location].filter(Boolean).join(" · "))
        ),
        h("button", {
          class: "btn primary",
          onClick: () => {
            const sel = new Set(store.get("fs.smart.flights", []));
            sel.add(f.id);
            store.set("fs.smart.flights", [...sel]);
            document.dispatchEvent(new CustomEvent("fs:flights-selected"));
            goTo("smart");
          },
        }, "Pakai untuk Foto → SMART")
      ),
      mapEl,
      h("dl", { class: "stats" },
        stat("Durasi", fmtDuration(f.durationSec)),
        stat("Jarak tempuh", fmtDistance(f.distanceM)),
        stat("Tinggi maks", `${fmtNum(f.maxHeightM)} m`),
        stat("Jarak maks dari home", fmtDistance(f.maxDistanceFromHomeM)),
        stat("Kecepatan maks", `${fmtNum(f.maxSpeedMs * 3.6)} km/j`),
        stat("Foto / video", `${f.photos ?? 0} / ${fmtDuration(f.videoSec)}`),
        stat("Versi log", String(f.version ?? "-")),
        stat("Selesai", fmtLocal(Date.parse(f.end), tz, { date: false }))
      ),
      h("div", { class: "downloads" },
        h("span", { class: "label" }, "Unduh"),
        dl("GPX", f.files.gpx, `${f.id}.gpx`),
        dl("KML", f.files.kml, `${f.id}.kml`),
        dl("CSV", f.files.csv, `${f.id}.csv`),
        dl("GeoJSON", f.files.geojson, `${f.id}.geojson`),
        dl("Log asli", f.log, f.log.split("/").pop()),
        h("a", { class: "btn ghost", href: gh + encodeURI(f.files.geojson), target: "_blank", rel: "noopener" }, "Lihat di GitHub")
      )
    );
    if (!mapApi || !mapApi.map.getContainer().isConnected) mapApi = null;
    mapApi = createMap(mapEl);
    try {
      const t = await ctx.loadTrack(f);
      if (selected !== f.id) return;
      mapApi.track(t.points.map((p) => [p.lat, p.lon]));
      if (f.home) mapApi.point([f.home.lat, f.home.lon], { color: "#1f6feb", radius: 7, title: "Home" });
      t.photos.forEach((p, i) => mapApi.point([p.lat, p.lon], { radius: 4, title: `Foto ${i + 1} · ${fmtLocal(p.ms, tz, { date: false, seconds: true })}` }));
      mapApi.fit();
      mapApi.refresh();
    } catch (e) {
      toast(`Track tidak bisa dimuat: ${e.message}`, "error");
    }
  }

  const stat = (k, v) => h("div", {}, h("dt", {}, k), h("dd", {}, v));

  document.addEventListener("fs:show", (e) => e.detail === "penerbangan" && mapApi?.refresh());
  document.addEventListener("fs:index-updated", () => load(true));
  load(false);
}
