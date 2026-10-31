// Tab "Foto → SMART": isi data patroli, pilih penerbangan, beri kategori & atribut SMART
// untuk setiap foto drone, lalu ekspor JSON SMART Mobile untuk diimpor ke SMART Desktop.

import { h, clear, store, toast, download, fmtLocal, fmtDistance, fmtNum, pickFiles } from "./ui.js";
import { createMap } from "./map.js";
import { categoryNodes, findNode, treeLeaves, listOptions, missingRequired, buildSmdata, positionAt } from "./smart.js";
import { readPhotoMeta, makeThumbnail, photoBase64 } from "./photos.js";
import { loadSmartFromFiles } from "./smart-loader.js";
import { rerender } from "./main.js";

const OBS_KEY = "fs.obs";

export function renderSmart(root, ctx) {
  const { model, metadata, project } = ctx.smart;
  const cats = categoryNodes(model);
  const s = ctx.settings;
  const tz = () => ctx.tzMin;

  const droneUuid = metadata.transport.find((t) => t.key === "drone")?.uuid ?? metadata.transport[0]?.uuid ?? "";
  const patrol = {
    transport: droneUuid, team: "", station: "", mandate: "", objective: "", comment: "",
    leader: "", pilot: "", members: [], armed: false, custom: {},
    ...store.get("fs.patrol", {}),
  };
  const savePatrol = () => store.set("fs.patrol", patrol);
  const obsStore = store.get(OBS_KEY, {});
  const saveObs = () => store.set(OBS_KEY, obsStore);

  let selectedFlights = new Set(store.get("fs.smart.flights", []));
  const localTracks = []; // {id, name, points}
  const photos = []; // {key, file, name, meta, thumb, include, nodeId, values, checked}
  let current = null;
  let mapApi = null;

  // ------------------------------------------------------------ kerangka
  const patrolBox = h("div", { class: "stack" });
  const flightsBox = h("div", { class: "stack" });
  const photoToolbar = h("div", { class: "row gap wrap" });
  const grid = h("div", { class: "photo-grid" });
  const editor = h("div", { class: "editor" });
  const mapEl = h("div", { class: "map small" });
  const exportBox = h("div", { class: "stack" });
  const summary = h("p", { class: "muted" });

  root.append(
    h("div", { class: "view-head" },
      h("div", {}, h("h2", {}, "Foto drone → SMART"), summary),
      h("div", { class: "small muted right" }, `Model: ${model.name}`, h("br"), project.projectName ? `Proyek: ${project.projectName}` : "")
    ),
    h("details", { class: "card", open: true }, h("summary", {}, h("span", { class: "step-no" }, "1"), "Data patroli"), patrolBox),
    h("details", { class: "card", open: true }, h("summary", {}, h("span", { class: "step-no" }, "2"), "Penerbangan (track patroli)"), flightsBox),
    h("details", { class: "card", open: true },
      h("summary", {}, h("span", { class: "step-no" }, "3"), "Foto & observasi"),
      h("div", { class: "stack" },
        photoToolbar,
        h("div", { class: "photo-work" }, h("div", { class: "photo-col" }, grid, mapEl), editor)
      )
    ),
    h("details", { class: "card", open: true }, h("summary", {}, h("span", { class: "step-no" }, "4"), "Ekspor ke SMART"), exportBox)
  );

  // ------------------------------------------------------------ 1. patroli
  function select(label, options, value, onChange, { required = false, empty = "- pilih -", id } = {}) {
    return h("label", { class: "field" },
      h("span", {}, label, required ? h("b", { class: "req", title: "wajib" }, " *") : null),
      h("select", { id, onChange: (e) => onChange(e.target.value) },
        h("option", { value: "" }, empty),
        options.map((o) => h("option", { value: o.uuid, selected: o.uuid === value }, o.name)))
    );
  }

  function renderPatrol() {
    const f = metadata.fields;
    const emp = metadata.employees;
    const empName = (u) => emp.find((e) => e.uuid === u)?.name ?? u;
    const memberOpts = patrol.members.map((u) => ({ uuid: u, name: empName(u) }));
    const pilotNeeded = metadata.pilotRequiredFor.includes(patrol.transport);
    const set = (k) => (v) => { patrol[k] = v; savePatrol(); renderPatrol(); renderExport(); };

    const custom = metadata.custom.filter((c) => c.visible).map((c) =>
      c.options.length
        ? select(c.name, c.options, patrol.custom[c.id], (v) => { patrol.custom[c.id] = v; savePatrol(); renderExport(); }, { required: c.required })
        : h("label", { class: "field" }, h("span", {}, c.name, c.required ? h("b", { class: "req" }, " *") : null),
            h("input", { type: "text", value: patrol.custom[c.id] ?? "", onChange: (e) => { patrol.custom[c.id] = e.target.value.trim(); savePatrol(); renderExport(); } }))
    );

    clear(patrolBox,
      h("div", { class: "form-grid" },
        select(f.transport.name || "Jenis transportasi", metadata.transport, patrol.transport, set("transport"), { required: f.transport.required, id: "p-transport" }),
        select(f.team.name || "Tim", metadata.teams, patrol.team, set("team"), { required: f.team.required, id: "p-team" }),
        select(f.station.name || "Pos", metadata.stations, patrol.station, set("station"), { required: f.station.required, id: "p-station" }),
        select(f.mandate.name || "Mandat", metadata.mandates, patrol.mandate, set("mandate"), { required: f.mandate.required, id: "p-mandate" }),
        ...custom,
        h("label", { class: "field check" },
          h("input", { type: "checkbox", id: "p-armed", checked: patrol.armed, onChange: (e) => { patrol.armed = e.target.checked; savePatrol(); } }),
          h("span", {}, f.armed.name || "Bersenjata"))
      ),
      h("label", { class: "field" }, h("span", {}, f.objective.name || "Tujuan"),
        h("input", { type: "text", id: "p-objective", value: patrol.objective, placeholder: "contoh: Pemantauan udara grid 235 dan 273", onChange: (e) => { patrol.objective = e.target.value.trim(); savePatrol(); } })),
      h("label", { class: "field" }, h("span", {}, f.comment.name || "Komentar"),
        h("textarea", { rows: 2, id: "p-comment", onChange: (e) => { patrol.comment = e.target.value.trim(); savePatrol(); } }, patrol.comment)),
      emp.length
        ? h("div", { class: "form-grid" },
            membersPicker(),
            select(f.leader.name || "Ketua", memberOpts, patrol.leader, set("leader"), { required: true, empty: memberOpts.length ? "- pilih dari petugas -" : "pilih petugas dulu", id: "p-leader" }),
            select(f.pilot.name || "Pilot", memberOpts, patrol.pilot, set("pilot"), { required: pilotNeeded, empty: memberOpts.length ? "- pilih dari petugas -" : "pilih petugas dulu", id: "p-pilot" }))
        : h("div", { class: "notice" },
            h("p", {}, "Daftar petugas belum dimuat di perangkat ini. SMART mewajibkan petugas dan ketua patroli."),
            h("p", { class: "small" }, "Muat paket SMART Mobile (.zip) atau file patrol_metadata.json dari SMART Desktop. Nama petugas hanya disimpan di peramban ini, tidak di repo."),
            h("button", { class: "btn primary", onClick: async () => { if (await loadSmartFromFiles(ctx)) rerender("smart"); } }, "Muat daftar petugas"))
    );
  }

  function membersPicker() {
    const emp = metadata.employees;
    const box = h("div", { class: "members" });
    const search = h("input", { type: "search", placeholder: "Cari nama petugas…", "aria-label": "Cari petugas" });
    const groupSel = h("select", { "aria-label": "Kelompok petugas" },
      h("option", { value: "" }, "Semua kelompok"),
      metadata.employeeGroups.map((g, i) => h("option", { value: String(i) }, g.name)));
    const listEl = h("div", { class: "member-list" });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const g = groupSel.value === "" ? null : new Set(metadata.employeeGroups[Number(groupSel.value)].members);
      const items = emp.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!g || g.has(e.uuid)));
      const chosen = new Set(patrol.members);
      items.sort((a, b) => Number(chosen.has(b.uuid)) - Number(chosen.has(a.uuid)) || a.name.localeCompare(b.name));
      clear(listEl, items.slice(0, 300).map((e) =>
        h("label", { class: "member" },
          h("input", { type: "checkbox", checked: chosen.has(e.uuid), onChange: (ev) => {
            const set = new Set(patrol.members);
            ev.target.checked ? set.add(e.uuid) : set.delete(e.uuid);
            patrol.members = [...set];
            if (!set.has(patrol.leader)) patrol.leader = "";
            if (!set.has(patrol.pilot)) patrol.pilot = "";
            savePatrol();
            renderPatrolKeepMembers();
            renderExport();
          } }),
          h("span", {}, e.name))));
    };
    search.addEventListener("input", draw);
    groupSel.addEventListener("change", draw);
    draw();
    box.append(
      h("span", { class: "field-label" }, metadata.fields.members.name || "Petugas", h("b", { class: "req" }, " *"), h("span", { class: "muted" }, ` (${patrol.members.length} dipilih)`)),
      h("div", { class: "row gap" }, search, groupSel),
      listEl
    );
    return box;
  }

  // Render ulang tanpa menutup daftar petugas yang sedang dicari.
  function renderPatrolKeepMembers() {
    const q = patrolBox.querySelector(".members input[type=search]")?.value ?? "";
    const g = patrolBox.querySelector(".members select")?.value ?? "";
    const scroll = patrolBox.querySelector(".member-list")?.scrollTop ?? 0;
    renderPatrol();
    const search = patrolBox.querySelector(".members input[type=search]");
    const sel = patrolBox.querySelector(".members select");
    if (search) {
      search.value = q;
      sel.value = g;
      search.dispatchEvent(new Event("input"));
      patrolBox.querySelector(".member-list").scrollTop = scroll;
    }
  }

  // ------------------------------------------------------------ 2. penerbangan
  async function renderFlights() {
    clear(flightsBox, h("p", { class: "muted" }, "Memuat daftar penerbangan…"));
    const index = await ctx.loadIndex();
    const ok = index.flights.filter((f) => f.status === "ok");
    const known = new Set(ok.map((f) => f.id));
    selectedFlights = new Set([...selectedFlights].filter((id) => known.has(id)));
    store.set("fs.smart.flights", [...selectedFlights]);
    const times = photos.map((p) => p.meta.ms).filter(Number.isFinite);
    const matches = (f) => times.some((t) => t >= Date.parse(f.start) - 60000 && t <= Date.parse(f.end) + 60000);
    clear(flightsBox,
      h("p", { class: "small muted" }, "Setiap penerbangan menjadi satu segmen patroli (jeda/lanjut di antara penerbangan, misalnya saat ganti baterai). Tanpa penerbangan, track dibuat dari lokasi foto."),
      ok.length
        ? h("div", { class: "flight-pick" }, ok.slice(0, 200).map((f) =>
            h("label", { class: `pick ${matches(f) ? "match" : ""}` },
              h("input", { type: "checkbox", checked: selectedFlights.has(f.id), onChange: (e) => {
                e.target.checked ? selectedFlights.add(f.id) : selectedFlights.delete(f.id);
                store.set("fs.smart.flights", [...selectedFlights]);
                refreshPositions();
              } }),
              h("span", {}, fmtLocal(Date.parse(f.start), tz())),
              h("span", { class: "muted" }, `${f.aircraft || "DJI"} · ${Math.round((f.durationSec || 0) / 60)} mnt · ${fmtDistance(f.distanceM)}`),
              matches(f) ? h("span", { class: "chip ok" }, "cocok dengan foto") : null)))
        : h("p", { class: "muted" }, ctx.indexError ?? "Belum ada penerbangan di repo."),
      localTracks.length ? h("ul", { class: "small" }, localTracks.map((t) => h("li", {}, `${t.name} (${t.points.length} titik, lokal)`))) : null,
      h("div", { class: "row gap wrap" },
        times.length && ok.some(matches) ? h("button", { class: "btn", onClick: () => { ok.filter(matches).forEach((f) => selectedFlights.add(f.id)); store.set("fs.smart.flights", [...selectedFlights]); renderFlights(); refreshPositions(); } }, "Pilih penerbangan yang cocok dengan foto") : null,
        h("button", { class: "btn ghost", onClick: addLocalGpx }, "Tambah track dari file GPX")
      )
    );
  }

  async function addLocalGpx() {
    const files = await pickFiles({ accept: ".gpx" });
    for (const file of files) {
      try {
        const doc = new DOMParser().parseFromString(await file.text(), "application/xml");
        const pts = [...doc.getElementsByTagName("trkpt")].map((p) => ({
          ms: Date.parse(p.getElementsByTagName("time")[0]?.textContent ?? ""),
          lat: Number(p.getAttribute("lat")),
          lon: Number(p.getAttribute("lon")),
          alt: Number(p.getElementsByTagName("ele")[0]?.textContent ?? 0),
          acc: 3,
        })).filter((p) => Number.isFinite(p.ms));
        if (!pts.length) throw new Error("tidak ada titik bertanda waktu");
        localTracks.push({ id: `local:${file.name}`, name: file.name, points: pts });
      } catch (e) {
        toast(`${file.name}: ${e.message}`, "error");
      }
    }
    renderFlights();
    refreshPositions();
  }

  async function selectedSegments() {
    const index = await ctx.loadIndex();
    const segs = [];
    for (const f of index.flights.filter((x) => x.status === "ok" && selectedFlights.has(x.id))) {
      const t = await ctx.loadTrack(f);
      segs.push({ id: f.id, points: t.points });
    }
    for (const t of localTracks) segs.push(t);
    return segs.sort((a, b) => a.points[0].ms - b.points[0].ms);
  }

  // ------------------------------------------------------------ 3. foto
  function obsState(p) {
    return { include: p.include, nodeId: p.nodeId, values: p.values };
  }

  function persist(p) {
    obsStore[p.key] = obsState(p);
    saveObs();
  }

  function status(p) {
    if (!p.include) return { cls: "skip", text: "Dilewati" };
    if (!p.pos) return { cls: "warn", text: "Tanpa lokasi" };
    const node = p.nodeId ? findNode(model, p.nodeId) : null;
    if (!node) return { cls: "todo", text: "Belum diisi" };
    const miss = missingRequired(node, p.values);
    return miss.length ? { cls: "warn", text: `Kurang ${miss.length} isian` } : { cls: "ok", text: node.name };
  }

  async function addPhotos() {
    const files = (await pickFiles({ accept: "image/jpeg,image/png,.jpg,.jpeg,.png" })).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    if (!files.length) return;
    clear(photoToolbar, h("p", { class: "muted" }, `Membaca ${files.length} foto…`));
    let n = 0;
    for (const file of files) {
      if (photos.some((p) => p.name === file.name && p.file.size === file.size)) continue;
      const meta = await readPhotoMeta(file, tz());
      const key = `${file.name}|${file.size}|${meta.ms ?? ""}`;
      const saved = obsStore[key] ?? {};
      let thumb = "";
      try {
        thumb = await makeThumbnail(file);
      } catch {}
      photos.push({ key, file, name: file.name, meta, thumb, include: saved.include ?? true, nodeId: saved.nodeId ?? "", values: saved.values ?? {}, checked: false, pos: null });
      clear(photoToolbar, h("p", { class: "muted" }, `Membaca foto ${++n} dari ${files.length}…`));
    }
    photos.sort((a, b) => (a.meta.ms ?? 0) - (b.meta.ms ?? 0));
    if (!current && photos.length) current = photos[0].key;
    await renderFlights();
    // otomatis pilih penerbangan yang waktunya cocok bila belum ada yang dipilih
    if (!selectedFlights.size) {
      const index = await ctx.loadIndex();
      const times = photos.map((p) => p.meta.ms).filter(Number.isFinite);
      const hits = index.flights.filter((f) => f.status === "ok" && times.some((t) => t >= Date.parse(f.start) - 60000 && t <= Date.parse(f.end) + 60000));
      if (hits.length) {
        hits.forEach((f) => selectedFlights.add(f.id));
        store.set("fs.smart.flights", [...selectedFlights]);
        toast(`${hits.length} penerbangan yang cocok dengan waktu foto dipilih otomatis.`);
        renderFlights();
      }
    }
    await refreshPositions();
  }

  /** Lokasi foto: GPS EXIF, atau interpolasi dari track penerbangan terpilih. */
  async function refreshPositions() {
    let segs = [];
    try {
      segs = await selectedSegments();
    } catch (e) {
      toast(`Track tidak bisa dimuat: ${e.message}`, "error");
    }
    const all = segs.flatMap((sg) => sg.points).sort((a, b) => a.ms - b.ms);
    for (const p of photos) {
      if (Number.isFinite(p.meta.lat)) p.pos = { lat: p.meta.lat, lon: p.meta.lon, alt: p.meta.alt ?? 0, source: "GPS foto" };
      else {
        const q = Number.isFinite(p.meta.ms) ? positionAt(all, p.meta.ms) : null;
        p.pos = q ? { ...q, source: "track penerbangan" } : null;
      }
    }
    renderPhotos();
    drawMap(segs);
    renderExport();
  }

  function renderToolbar() {
    const checked = photos.filter((p) => p.checked);
    const cur = photos.find((p) => p.key === current);
    clear(photoToolbar,
      h("button", { class: "btn primary", onClick: addPhotos }, photos.length ? "Tambah foto" : "Pilih foto drone"),
      photos.length ? h("button", { class: "btn", onClick: () => { const all = photos.every((p) => p.checked); photos.forEach((p) => (p.checked = !all)); renderPhotos(); } }, photos.every((p) => p.checked) ? "Batal pilih semua" : "Pilih semua") : null,
      checked.length && cur?.nodeId ? h("button", { class: "btn", onClick: applyToChecked }, `Salin isian foto ini ke ${checked.length} foto terpilih`) : null,
      checked.length ? h("button", { class: "btn ghost", onClick: () => { checked.forEach((p) => { p.include = false; persist(p); }); renderPhotos(); renderExport(); } }, `Lewati ${checked.length} foto terpilih`) : null,
      photos.length ? h("span", { class: "small muted" }, `${photos.filter((p) => p.include).length} dari ${photos.length} foto masuk SMART`) : null
    );
  }

  function applyToChecked() {
    const src = photos.find((p) => p.key === current);
    for (const p of photos.filter((x) => x.checked && x !== src)) {
      p.nodeId = src.nodeId;
      p.values = structuredClone(src.values);
      p.include = true;
      persist(p);
    }
    toast("Isian disalin.");
    renderPhotos();
    renderExport();
  }

  function renderPhotos() {
    renderToolbar();
    summary.textContent = photos.length
      ? `${photos.length} foto · ${photos.filter((p) => status(p).cls === "ok").length} siap · ${selectedFlights.size + localTracks.length} penerbangan dipilih`
      : "Tambahkan foto drone, beri kategori SMART, lalu unduh file JSON untuk SMART Desktop.";
    if (!photos.length) {
      clear(grid, h("div", { class: "empty" }, h("p", {}, "Belum ada foto. Pilih foto JPG dari kartu SD drone; lokasi dan jam diambil dari metadata foto.")));
      clear(editor);
      return;
    }
    clear(grid, photos.map((p) => {
      const st = status(p);
      return h("div", { class: `photo ${p.key === current ? "active" : ""} ${st.cls}`, "data-key": p.key },
        h("button", { class: "photo-open", onClick: () => openPhoto(p.key), "aria-label": `Buka ${p.name}` },
          p.thumb ? h("img", { src: p.thumb, alt: "", loading: "lazy" }) : h("div", { class: "noimg" }, "JPG"),
          h("span", { class: "photo-time" }, fmtLocal(p.meta.ms, tz(), { date: false, seconds: true })),
          h("span", { class: `photo-status ${st.cls}` }, st.text)),
        h("label", { class: "photo-check", title: "Pilih untuk salin isian" },
          h("input", { type: "checkbox", checked: p.checked, onChange: (e) => { p.checked = e.target.checked; renderToolbar(); } })));
    }));
    renderEditor();
  }

  function openPhoto(key) {
    current = key;
    for (const el of grid.querySelectorAll(".photo")) el.classList.toggle("active", el.dataset.key === key);
    renderToolbar();
    renderEditor();
    if (window.matchMedia("(max-width: 900px)").matches) editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateTile(p) {
    const el = grid.querySelector(`.photo[data-key="${CSS.escape(p.key)}"]`);
    if (!el) return;
    const st = status(p);
    el.className = `photo ${p.key === current ? "active" : ""} ${st.cls}`;
    const badge = el.querySelector(".photo-status");
    badge.className = `photo-status ${st.cls}`;
    badge.textContent = st.text;
    const done = photos.filter((x) => status(x).cls === "ok").length;
    summary.textContent = `${photos.length} foto · ${done} siap · ${selectedFlights.size + localTracks.length} penerbangan dipilih`;
  }

  function categorySelect(p) {
    const groups = model.nodes.map((top) => {
      if (top.categoryUuid) return h("option", { value: top.id, selected: p.nodeId === top.id }, top.name);
      const items = [];
      const walk = (n, trail) => {
        if (n.categoryUuid) items.push(h("option", { value: n.id, selected: p.nodeId === n.id }, [...trail, n.name].join(" › ")));
        n.children.forEach((c) => walk(c, n.categoryUuid ? [...trail, n.name] : trail));
      };
      top.children.forEach((c) => walk(c, []));
      return h("optgroup", { label: top.name }, items);
    });
    return h("select", { id: "obs-category", onChange: (e) => { p.nodeId = e.target.value; p.include = true; persist(p); updateTile(p); renderEditor(); renderExport(); } },
      h("option", { value: "" }, "- pilih kategori -"), groups);
  }

  function attributeInput(p, a) {
    const v = p.values[a.uuid];
    const set = (val) => {
      if (val === "" || val === null || val === undefined) delete p.values[a.uuid];
      else p.values[a.uuid] = val;
      persist(p);
      updateTile(p);
      markMissing();
      renderExport();
    };
    const id = `attr-${a.uuid}`;
    const cfg = a.configId ? model.configs[a.configId] : null;
    let input;
    if (a.type === "LIST" || a.type === "TREE") {
      const opts = a.type === "LIST" ? listOptions(cfg).map((o) => ({ uuid: o.uuid, name: o.name, group: "" })) : treeLeaves(cfg).map((o) => ({ uuid: o.uuid, name: o.name, group: o.path.slice(0, -1).join(" › ") }));
      const groups = new Map();
      for (const o of opts) {
        if (!groups.has(o.group)) groups.set(o.group, []);
        groups.get(o.group).push(h("option", { value: o.uuid, selected: o.uuid === v }, o.name));
      }
      const sel = h("select", { id, onChange: (e) => set(e.target.value) },
        h("option", { value: "" }, opts.length ? "-" : "(tidak ada pilihan di model)"),
        [...groups].map(([g, items]) => (g ? h("optgroup", { label: g }, items) : items)));
      input = opts.length > 25
        ? h("div", { class: "searchable" },
            h("input", { type: "search", placeholder: "Cari…", "aria-label": `Cari ${a.name}`, onInput: (e) => {
              const q = e.target.value.trim().toLowerCase();
              for (const o of sel.querySelectorAll("option")) if (o.value) o.hidden = q && !o.textContent.toLowerCase().includes(q) && !(o.parentElement.label ?? "").toLowerCase().includes(q);
              for (const g of sel.querySelectorAll("optgroup")) g.hidden = ![...g.children].some((o) => !o.hidden);
            } }),
            sel)
        : sel;
    } else if (a.type === "NUMERIC") {
      input = h("input", { id, type: "number", step: "any", inputmode: "decimal", value: v ?? "", onChange: (e) => set(e.target.value) });
    } else if (a.type === "BOOLEAN") {
      input = h("select", { id, onChange: (e) => set(e.target.value === "" ? "" : e.target.value === "true") },
        h("option", { value: "" }, "-"), h("option", { value: "true", selected: v === true }, "Ya"), h("option", { value: "false", selected: v === false }, "Tidak"));
    } else if (a.type === "DATE") {
      input = h("input", { id, type: "date", value: v ?? "", onChange: (e) => set(e.target.value) });
    } else {
      input = /keterangan|catatan|isi/i.test(a.key)
        ? h("textarea", { id, rows: 2, onChange: (e) => set(e.target.value.trim()) }, v ?? "")
        : h("input", { id, type: "text", value: v ?? "", onChange: (e) => set(e.target.value.trim()) });
    }
    return h("label", { class: "field", "data-attr": a.uuid }, h("span", {}, a.name, a.required ? h("b", { class: "req", title: "wajib" }, " *") : null), input);
  }

  function markMissing() {
    const p = photos.find((x) => x.key === current);
    const node = p?.nodeId ? findNode(model, p.nodeId) : null;
    if (!node) return;
    for (const a of node.attributes) {
      const el = editor.querySelector(`[data-attr="${a.uuid}"]`);
      if (el) el.classList.toggle("missing", a.required && missingRequired({ attributes: [a] }, p.values).length > 0);
    }
  }

  function renderEditor() {
    const p = photos.find((x) => x.key === current);
    if (!p) return clear(editor);
    const i = photos.indexOf(p);
    const node = p.nodeId ? findNode(model, p.nodeId) : null;
    const m = p.meta;
    clear(editor,
      h("div", { class: "editor-head" },
        h("button", { class: "btn ghost", disabled: i === 0, onClick: () => openPhoto(photos[i - 1].key), "aria-label": "Foto sebelumnya" }, "‹"),
        h("div", {}, h("strong", { class: "wrap-any" }, p.name), h("div", { class: "small muted" }, `${i + 1} dari ${photos.length}`)),
        h("button", { class: "btn ghost", disabled: i === photos.length - 1, onClick: () => openPhoto(photos[i + 1].key), "aria-label": "Foto berikutnya" }, "›")
      ),
      p.thumb ? h("img", { class: "preview", src: p.thumb, alt: `Pratinjau ${p.name}` }) : null,
      h("dl", { class: "meta" },
        h("div", {}, h("dt", {}, "Waktu"), h("dd", {}, fmtLocal(m.ms, tz(), { seconds: true }))),
        h("div", {}, h("dt", {}, "Lokasi"), h("dd", {}, p.pos ? `${p.pos.lat.toFixed(6)}, ${p.pos.lon.toFixed(6)} (${p.pos.source})` : h("span", { class: "warn-text" }, "tidak ada: foto tanpa GPS dan di luar track terpilih"))),
        h("div", {}, h("dt", {}, "Ketinggian"), h("dd", {}, [Number.isFinite(m.relAlt) ? `${fmtNum(m.relAlt, 1)} m dari take-off` : null, Number.isFinite(p.pos?.alt) ? `${fmtNum(p.pos.alt, 1)} m dpl` : null].filter(Boolean).join(" · ") || "-")),
        Number.isFinite(m.gimbalPitch) ? h("div", {}, h("dt", {}, "Gimbal"), h("dd", {}, `pitch ${fmtNum(m.gimbalPitch, 1)}°, arah ${fmtNum(m.gimbalYaw, 0)}°`)) : null
      ),
      h("label", { class: "field check" },
        h("input", { type: "checkbox", id: "obs-include", checked: p.include, onChange: (e) => { p.include = e.target.checked; persist(p); updateTile(p); renderEditor(); renderExport(); } }),
        h("span", {}, "Masukkan foto ini ke SMART")),
      p.include
        ? h("div", { class: "stack" },
            h("label", { class: "field" }, h("span", {}, "Kategori", h("b", { class: "req" }, " *")), categorySelect(p)),
            node ? node.attributes.filter((a) => a.visible).map((a) => attributeInput(p, a)) : null,
            h("div", { class: "row gap wrap" },
              i < photos.length - 1 ? h("button", { class: "btn primary", onClick: () => openPhoto(photos[i + 1].key) }, "Simpan & foto berikutnya") : null,
              i > 0 && photos[i - 1].nodeId ? h("button", { class: "btn", onClick: () => { const prev = photos[i - 1]; p.nodeId = prev.nodeId; p.values = structuredClone(prev.values); persist(p); updateTile(p); renderEditor(); renderExport(); } }, "Sama dengan foto sebelumnya") : null))
        : h("p", { class: "muted" }, "Foto ini tidak akan dimasukkan ke JSON SMART.")
    );
    markMissing();
  }

  function drawMap(segs) {
    if (!photos.length && !segs.length) {
      mapEl.hidden = true;
      return;
    }
    mapEl.hidden = false;
    if (!mapApi || !mapApi.map.getContainer().isConnected) mapApi = createMap(mapEl);
    mapApi.clear();
    for (const sg of segs) mapApi.track(sg.points.map((p) => [p.lat, p.lon]));
    for (const p of photos) {
      if (!p.pos) continue;
      const st = status(p);
      const color = { ok: "#2da44e", warn: "#d29922", todo: "#d1242f", skip: "#8c959f" }[st.cls] ?? "#d1242f";
      mapApi.point([p.pos.lat, p.pos.lon], { color, title: `${p.name} · ${st.text}`, onClick: () => openPhoto(p.key) });
    }
    mapApi.fit();
    mapApi.refresh();
  }

  // ------------------------------------------------------------ 4. ekspor
  function problems() {
    const out = [];
    const f = metadata.fields;
    if (f.transport.required && !patrol.transport) out.push("Pilih jenis transportasi patroli.");
    if (f.mandate.required && !patrol.mandate) out.push("Pilih mandat patroli.");
    if (f.team.required && !patrol.team) out.push("Pilih tim.");
    if (f.station.required && !patrol.station) out.push("Pilih pos.");
    for (const c of metadata.custom) if (c.required && c.visible && !patrol.custom[c.id]) out.push(`Isi ${c.name}.`);
    if (!metadata.employees.length) out.push("Muat daftar petugas (patrol_metadata.json) lalu pilih petugas patroli.");
    else {
      if (!patrol.members.length) out.push("Pilih minimal satu petugas.");
      if (!patrol.leader) out.push("Pilih ketua patroli.");
      if (metadata.pilotRequiredFor.includes(patrol.transport) && !patrol.pilot) out.push("Pilih pilot (wajib untuk transportasi drone).");
    }
    const inc = photos.filter((p) => p.include);
    if (!inc.length && !selectedFlights.size && !localTracks.length) out.push("Tambahkan foto atau pilih penerbangan.");
    const noCat = inc.filter((p) => !p.nodeId).length;
    if (noCat) out.push(`${noCat} foto belum diberi kategori (atau tandai "Lewati").`);
    const miss = inc.filter((p) => p.nodeId && missingRequired(findNode(model, p.nodeId), p.values).length).length;
    if (miss) out.push(`${miss} foto masih kurang isian wajib.`);
    const noPos = inc.filter((p) => !p.pos).length;
    if (noPos) out.push(`${noPos} foto tidak punya lokasi. Pilih penerbangan yang mencakup jam foto tersebut atau lewati fotonya.`);
    return out;
  }

  function renderExport() {
    const probs = problems();
    clear(exportBox,
      probs.length
        ? h("div", { class: "notice" }, h("p", {}, "Sebelum ekspor:"), h("ul", {}, probs.map((t) => h("li", {}, t))))
        : h("p", {}, h("span", { class: "chip ok" }, "Siap"), ` ${photos.filter((p) => p.include).length} observasi foto dan ${selectedFlights.size + localTracks.length} penerbangan akan menjadi satu patroli.`),
      h("div", { class: "row gap wrap" },
        h("button", { class: "btn primary", disabled: probs.length > 0, onClick: doExport }, "Unduh JSON SMART")),
      h("details", {},
        h("summary", {}, "Cara impor ke SMART Desktop"),
        h("ol", { class: "small" },
          h("li", {}, "Buka SMART Desktop dan Conservation Area TN Tambora."),
          h("li", {}, "Menu ", h("b", {}, "Field Data → SMART Mobile → Import…"), "."),
          h("li", {}, "Ubah ", h("b", {}, "Import From"), " menjadi ", h("b", {}, "Files"), ", tekan ", h("b", {}, "Add"), ", pilih file SMDATA_….json, lalu ", h("b", {}, "Import"), "."),
          h("li", {}, "Periksa patroli baru di daftar patroli. Simpan file JSON sampai impor dipastikan berhasil.")))
    );
  }

  async function doExport() {
    const btn = exportBox.querySelector("button.primary");
    btn.disabled = true;
    const progress = h("p", { class: "muted" }, "Menyiapkan…");
    exportBox.append(progress);
    try {
      const segs = await selectedSegments();
      const inc = photos.filter((p) => p.include && p.nodeId && p.pos);
      const observations = [];
      let n = 0;
      for (const p of inc) {
        progress.textContent = `Memproses foto ${++n} dari ${inc.length}…`;
        observations.push({
          ms: p.meta.ms,
          lat: p.pos.lat,
          lon: p.pos.lon,
          alt: p.pos.alt ?? 0,
          node: findNode(model, p.nodeId),
          values: p.values,
          photos: [await photoBase64(p.file, Number(s.photoMax) || 0, Number(s.photoQuality) || 0.85)],
        });
      }
      progress.textContent = "Menyusun JSON…";
      const out = buildSmdata({
        patrol,
        segments: segs,
        observations,
        cmUuid: metadata.cmUuid,
        tzMin: tz(),
        trackIntervalSec: Number(s.trackInterval) || 5,
        deviceId: s.deviceId,
        appName: project.projectName || model.name,
      });
      const json = JSON.stringify(out.data);
      download(out.filename, json, "application/json");
      clear(progress);
      progress.className = "";
      progress.append(
        h("span", { class: "chip ok" }, "Terunduh"),
        ` ${out.filename} · ${fmtNum(json.length / 1024 / 1024, 1)} MB · ${out.summary.observations} observasi, ${out.summary.photos} foto, ${out.summary.trackPoints} titik track, ${fmtDistance(out.summary.distanceM)}.`
      );
      for (const w of out.warnings) exportBox.append(h("p", { class: "small warn-text" }, w));
    } catch (e) {
      progress.className = "notice error";
      progress.textContent = `Ekspor gagal: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  // Tampilan ini bisa dirender ulang (model SMART diganti); pendengar lama berhenti sendiri.
  const alive = () => root.contains(patrolBox);
  document.addEventListener("fs:flights-selected", () => {
    if (!alive()) return;
    selectedFlights = new Set(store.get("fs.smart.flights", []));
    renderFlights();
    refreshPositions();
  });
  document.addEventListener("fs:show", (e) => alive() && e.detail === "smart" && mapApi?.refresh());

  renderPatrol();
  renderFlights();
  renderPhotos();
  renderExport();
  refreshPositions();
}
