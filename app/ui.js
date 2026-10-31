// Utilitas DOM kecil dan format angka/waktu untuk tampilan berbahasa Indonesia.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return "-";
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} mnt` : `${m} mnt`;
}

export function fmtDistance(m) {
  if (!Number.isFinite(m)) return "-";
  return m >= 1000 ? `${(m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} km` : `${Math.round(m)} m`;
}

export const fmtNum = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString("id-ID", { maximumFractionDigits: d }) : "-");

/** ms UTC -> "26 Okt 2026 09.00" pada offset tertentu. */
export function fmtLocal(ms, tzMin, { date = true, time = true, seconds = false } = {}) {
  if (!Number.isFinite(ms)) return "-";
  const d = new Date(ms + tzMin * 60000);
  const opts = { timeZone: "UTC" };
  if (date) Object.assign(opts, { day: "numeric", month: "short", year: "numeric" });
  if (time) Object.assign(opts, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
  return d.toLocaleString("id-ID", opts);
}

export function parseOffset(text) {
  const m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(String(text ?? "").trim());
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 480;
}

export function download(name, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function toast(message, kind = "info") {
  let host = $("#toasts");
  if (!host) document.body.append((host = h("div", { id: "toasts", role: "status", "aria-live": "polite" })));
  const t = h("div", { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), kind === "error" ? 9000 : 4500);
}

export function pickFiles({ accept = "", multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, multiple, style: { display: "none" } });
    const done = (files) => {
      resolve(files);
      input.remove();
    };
    input.addEventListener("change", () => done([...input.files]));
    input.addEventListener("cancel", () => done([]));
    document.body.append(input);
    input.click();
  });
}
