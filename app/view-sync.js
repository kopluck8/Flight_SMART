// Tab "Sinkron log": unggah file DJIFlightRecord_*.txt ke folder logs/ di repo (satu commit),
// lalu pantau GitHub Actions sampai penerbangan selesai diproses.

import { h, clear, fmtNum, toast, pickFiles } from "./ui.js";
import { gitBlobSha } from "./github.js";
import { goTo } from "./main.js";

export function renderSync(root, ctx) {
  const s = ctx.settings;
  let files = [];
  let existing = null;

  const status = h("div", { class: "sync-status" });
  const table = h("div", { class: "sync-files" });
  const actions = h("div", { class: "row gap wrap" });

  root.append(
    h("div", { class: "view-head" },
      h("div", {},
        h("h2", {}, "Sinkron log terbang"),
        h("p", { class: "muted" }, "Pilih file log DJI dari ponsel atau komputer. File yang sudah ada di repo dilewati otomatis, lalu GitHub memproses yang baru menjadi GPX, KML, dan CSV.")
      )
    ),
    h("div", { class: "card stack" },
      h("ol", { class: "steps" },
        h("li", {}, "Ambil log dari ponsel. DJI GO 4: ", h("code", {}, "DJI/dji.go.v4/FlightRecord"), ". DJI Fly: ", h("code", {}, "Android/data/dji.go.v5/files/FlightRecord"), " (sambungkan kabel USB ke komputer bila folder ini tidak bisa dibuka dari ponsel)."),
        h("li", {}, "Pilih file ", h("code", {}, "DJIFlightRecord_*.txt"), " di bawah, lalu tekan Unggah."),
        h("li", {}, "Tunggu ±1–2 menit sampai GitHub Actions selesai. Penerbangan baru muncul di tab Penerbangan.")
      ),
      tokenNotice(),
      actions,
      table,
      status
    ),
    h("details", { class: "card" },
      h("summary", {}, "Cara lain tanpa token"),
      h("p", {}, "Buka ", h("a", { href: `https://github.com/${s.owner}/${s.repo}/upload/${s.branch}/logs`, target: "_blank", rel: "noopener" }, "halaman unggah folder logs/ di GitHub"),
        ", seret file log ke sana, lalu tekan Commit changes. Pemrosesan otomatis berjalan sama persis.")
    )
  );

  function tokenNotice() {
    if (s.token) return h("p", { class: "small muted" }, `Mengunggah ke ${s.owner}/${s.repo} (cabang ${s.branch}).`);
    return h("div", { class: "notice" },
      "Untuk mengunggah dari aplikasi ini, isi token GitHub dulu di ",
      h("a", { href: "#pengaturan" }, "Pengaturan"),
      ". Token cukup diisi sekali di perangkat ini.");
  }

  function renderActions() {
    clear(actions,
      h("button", { class: "btn", onClick: choose }, files.length ? "Tambah file" : "Pilih file log"),
      files.length ? h("button", { class: "btn primary", disabled: !s.token || !files.some((f) => f.state === "baru"), onClick: upload }, `Unggah ${files.filter((f) => f.state === "baru").length} file`) : null,
      files.length ? h("button", { class: "btn ghost", onClick: () => { files = []; render(); } }, "Kosongkan") : null
    );
  }

  function render() {
    renderActions();
    if (!files.length) return clear(table);
    clear(table, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "File"), h("th", { class: "num" }, "Ukuran"), h("th", {}, "Status"))),
      h("tbody", {}, files.map((f) => h("tr", {},
        h("td", { class: "wrap-any" }, f.name),
        h("td", { class: "num" }, `${fmtNum(f.bytes.length / 1024 / 1024, 1)} MB`),
        h("td", {}, h("span", { class: `chip ${f.state === "baru" ? "ok" : f.state === "sudah ada" ? "" : "warn"}` }, f.state))
      )))
    ));
  }

  async function choose() {
    const picked = (await pickFiles({ accept: ".txt,.TXT,text/plain" })).filter((f) => /\.txt$/i.test(f.name));
    if (!picked.length) return toast("Pilih file log berakhiran .txt");
    if (s.token && !existing) {
      try {
        existing = new Map((await ctx.repo().listTree("logs/")).map((t) => [t.sha, t.path]));
      } catch (e) {
        existing = new Map();
        toast(e.message, "error");
      }
    }
    for (const file of picked) {
      if (files.some((f) => f.name === file.name && f.bytes.length === file.size)) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha = await gitBlobSha(bytes);
      const dup = existing?.get(sha);
      files.push({ name: file.name, bytes, sha, state: dup ? "sudah ada" : files.some((f) => f.sha === sha) ? "duplikat" : "baru" });
    }
    render();
  }

  async function upload() {
    const todo = files.filter((f) => f.state === "baru");
    const btns = actions.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try {
      const gh = ctx.repo();
      const commit = await gh.commitFiles(
        todo.map((f) => ({ path: `logs/${f.name}`, bytes: f.bytes })),
        `Tambah ${todo.length} log terbang`,
        (msg) => clear(status, h("p", {}, msg))
      );
      todo.forEach((f) => (f.state = "terunggah"));
      existing = null;
      render();
      clear(status,
        h("p", {}, "Terunggah. ", h("a", { href: commit.html_url, target: "_blank", rel: "noopener" }, "Lihat commit"), "."),
        h("p", { class: "muted" }, "Menunggu GitHub Actions memproses log…"));
      await watch(gh, commit.sha);
    } catch (e) {
      clear(status, h("div", { class: "notice error" }, e.message));
    } finally {
      renderActions();
    }
  }

  async function watch(gh, sha) {
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 8000));
      let runs = [];
      try {
        runs = await gh.runsForCommit(sha);
      } catch {
        // izin Actions tidak wajib: cukup tunggu lalu muat ulang indeks.
        if (Date.now() - started > 120000) break;
        continue;
      }
      const run = runs[0];
      if (!run) continue;
      const line = h("p", { class: "muted" }, `GitHub Actions: ${run.status === "completed" ? run.conclusion : run.status}. `, h("a", { href: run.html_url, target: "_blank", rel: "noopener" }, "Lihat log proses"));
      clear(status, status.firstChild, line);
      if (run.status === "completed") break;
    }
    await new Promise((r) => setTimeout(r, 4000));
    await ctx.loadIndex(true);
    document.dispatchEvent(new CustomEvent("fs:index-updated"));
    status.append(h("p", {}, "Selesai. ", h("button", { class: "btn primary", onClick: () => goTo("penerbangan") }, "Lihat penerbangan")));
  }

  render();
}
