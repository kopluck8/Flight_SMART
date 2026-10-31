// Tab "Pengaturan": repo & token GitHub, zona waktu, opsi ekspor, dan sumber model SMART.

import { h, clear, store, toast, fmtNum } from "./ui.js";
import { categoryNodes } from "./smart.js";
import { loadSmartFromFiles } from "./smart-loader.js";
import { rerender } from "./main.js";

const ZONES = [
  ["+07:00", "WIB (UTC+07:00)"],
  ["+08:00", "WITA (UTC+08:00)"],
  ["+09:00", "WIT (UTC+09:00)"],
];

export function renderSettings(root, ctx) {
  const s = ctx.settings;
  const field = (label, input, hint) => h("label", { class: "field" }, h("span", {}, label), input, hint ? h("small", { class: "muted" }, hint) : null);
  const text = (key, attrs = {}) => h("input", { type: "text", value: s[key] ?? "", ...attrs, onChange: (e) => { s[key] = e.target.value.trim(); ctx.saveSettings(); } });
  const numeric = (key, attrs = {}) => h("input", { type: "number", value: s[key], ...attrs, onChange: (e) => { s[key] = Number(e.target.value); ctx.saveSettings(); } });

  const connStatus = h("p", { class: "small" });
  const smartBox = h("div", { class: "stack" });

  root.append(
    h("div", { class: "view-head" }, h("div", {}, h("h2", {}, "Pengaturan"), h("p", { class: "muted" }, "Disimpan di peramban perangkat ini saja."))),
    h("div", { class: "grid-2" },
      h("div", { class: "card stack" },
        h("h3", {}, "Repo GitHub"),
        h("div", { class: "row gap wrap" },
          field("Pemilik", text("owner", { id: "set-owner", autocomplete: "off" })),
          field("Nama repo", text("repo", { id: "set-repo", autocomplete: "off" })),
          field("Cabang", text("branch", { id: "set-branch", autocomplete: "off" }))
        ),
        field("Token GitHub", h("input", {
          id: "set-token", type: "password", value: s.token, autocomplete: "off", placeholder: "github_pat_…",
          onChange: (e) => { s.token = e.target.value.trim(); ctx.saveSettings(); ctx.index = null; },
        }), h("span", {}, "Wajib untuk mengunggah log dan untuk repo private. Buat ",
          h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "fine-grained token"),
          ": pilih repo ini saja, izin Contents = Read and write dan Actions = Read-only.")),
        h("div", { class: "row gap" }, h("button", { class: "btn", onClick: test }, "Tes koneksi")),
        connStatus
      ),
      h("div", { class: "card stack" },
        h("h3", {}, "Waktu & ekspor SMART"),
        field("Zona waktu lokal", h("select", { id: "set-tz", onChange: (e) => { s.tz = e.target.value; ctx.saveSettings(); } },
          ZONES.map(([v, l]) => h("option", { value: v, selected: s.tz === v }, l))),
          "Dipakai untuk jam foto, nama penerbangan, dan waktu di JSON SMART."),
        field("Interval titik track SMART (detik)", numeric("trackInterval", { id: "set-interval", min: 1, max: 300, step: 1 }), "SMART Mobile memakai 15 detik. Untuk drone, 2–5 detik memberi jalur lebih rapi."),
        field("Ukuran foto maksimum (piksel sisi terpanjang)", numeric("photoMax", { id: "set-photomax", min: 0, step: 100 }), "1600 cukup tajam sebagai bukti dan menjaga ukuran file JSON. Isi 0 untuk foto asli (file JSON jadi sangat besar)."),
        field("Kualitas JPEG (0,5–1)", numeric("photoQuality", { id: "set-quality", min: 0.5, max: 1, step: 0.05 }))
      )
    ),
    h("div", { class: "card stack" },
      h("h3", {}, "Model data SMART"),
      smartBox
    ),
    h("div", { class: "card stack" },
      h("h3", {}, "Data lokal"),
      h("p", { class: "small muted" }, "Menghapus token, isian patroli, isian foto, dan model SMART yang dimuat dari perangkat ini."),
      h("div", {}, h("button", { class: "btn danger", onClick: resetAll }, "Hapus semua data lokal"))
    )
  );

  async function test() {
    clear(connStatus, "Menghubungi GitHub…");
    try {
      const info = await ctx.repo().info();
      const perm = info.permissions?.push ? "bisa mengunggah" : "hanya baca";
      clear(connStatus, h("span", { class: "chip ok" }, "Terhubung"), ` ${info.full_name} · ${info.private ? "private" : "public"} · ${perm}`);
    } catch (e) {
      clear(connStatus, h("span", { class: "chip warn" }, "Gagal"), " ", e.message);
    }
  }

  function renderSmart() {
    const { model, metadata, project, source, metadataSource } = ctx.smart;
    const cats = categoryNodes(model);
    clear(smartBox,
      h("dl", { class: "stats" },
        h("div", {}, h("dt", {}, "Configurable Model"), h("dd", {}, `${model.name} (${source})`)),
        h("div", {}, h("dt", {}, "Kategori"), h("dd", {}, fmtNum(cats.length))),
        h("div", {}, h("dt", {}, "Proyek SMART Mobile"), h("dd", {}, project.projectName || "-")),
        h("div", {}, h("dt", {}, "Petugas"), h("dd", {}, metadata.employees.length ? `${metadata.employees.length} orang (${metadataSource})` : "belum dimuat"))
      ),
      metadata.employees.length ? null : h("div", { class: "notice" },
        "Daftar petugas tidak disertakan di repo agar nama petugas tidak terbuka untuk umum. Muat sekali dari paket SMART Mobile (.zip) atau file ",
        h("code", {}, "patrol_metadata.json"), "; datanya hanya tersimpan di perangkat ini."),
      h("div", { class: "row gap wrap" },
        h("button", { class: "btn primary", onClick: loadFiles }, "Muat paket SMART Mobile / file model"),
        source === "custom" || metadataSource === "custom" ? h("button", { class: "btn ghost", onClick: () => { store.remove("fs.smart"); ctx.loadSmart(); renderSmart(); rerender("smart"); toast("Kembali ke model bawaan."); } }, "Kembalikan ke bawaan") : null
      ),
      h("p", { class: "small muted" }, "Bisa berupa: paket SMART Mobile (.zip berisi cm_model.xml dan patrol_metadata.json), ekspor Configurable Model (.zip atau .xml), atau patrol_metadata.json.")
    );
  }

  async function loadFiles() {
    if (await loadSmartFromFiles(ctx)) {
      renderSmart();
      rerender("smart");
    }
  }

  function resetAll() {
    if (!root.querySelector(".confirm-reset")) {
      const box = h("div", { class: "notice error confirm-reset" }, "Yakin? Semua isian foto dan token di perangkat ini akan hilang. ",
        h("button", { class: "btn danger", onClick: () => {
          try {
            Object.keys(localStorage).filter((k) => k.startsWith("fs.")).forEach((k) => localStorage.removeItem(k));
          } catch {}
          location.reload();
        } }, "Ya, hapus"));
      root.lastChild.append(box);
    }
  }

  renderSmart();
}
