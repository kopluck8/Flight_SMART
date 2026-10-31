// Akses repo GitHub lewat REST API: baca file, unggah log (satu commit), cek status Actions.

const API = "https://api.github.com";

export class GitHubRepo {
  constructor({ owner, repo, branch = "main", token = "" }) {
    Object.assign(this, { owner, repo, branch, token });
  }

  get base() {
    return `${API}/repos/${this.owner}/${this.repo}`;
  }

  get webUrl() {
    return `https://github.com/${this.owner}/${this.repo}`;
  }

  async request(path, { method = "GET", body, accept = "application/vnd.github+json", raw = false } = {}) {
    const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path.startsWith("http") ? path : `${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        msg = (await res.json()).message || msg;
      } catch {}
      const err = new Error(explain(res.status, msg, Boolean(this.token)));
      err.status = res.status;
      throw err;
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }

  async info() {
    return this.request("");
  }

  /** Isi file mentah (ArrayBuffer). */
  async readFile(path) {
    const res = await this.request(`/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`, { accept: "application/vnd.github.raw+json", raw: true });
    return res.arrayBuffer();
  }

  async readJson(path) {
    return JSON.parse(new TextDecoder().decode(await this.readFile(path)));
  }

  /** Semua file di bawah folder tertentu: [{path, size, sha}]. */
  async listTree(prefix) {
    const tree = await this.request(`/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
    return tree.tree.filter((t) => t.type === "blob" && t.path.startsWith(prefix)).map((t) => ({ path: t.path, size: t.size, sha: t.sha }));
  }

  /** Unggah beberapa file sekaligus sebagai satu commit. files: [{path, bytes: Uint8Array}] */
  async commitFiles(files, message, onProgress = () => {}) {
    const ref = await this.request(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const parent = await this.request(`/git/commits/${ref.object.sha}`);
    const tree = [];
    let i = 0;
    for (const f of files) {
      onProgress(`Mengunggah ${f.path} (${++i}/${files.length})`);
      const blob = await this.request("/git/blobs", { method: "POST", body: { content: toBase64(f.bytes), encoding: "base64" } });
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    onProgress("Membuat commit…");
    const newTree = await this.request("/git/trees", { method: "POST", body: { base_tree: parent.tree.sha, tree } });
    const commit = await this.request("/git/commits", { method: "POST", body: { message, tree: newTree.sha, parents: [ref.object.sha] } });
    await this.request(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: "PATCH", body: { sha: commit.sha } });
    return commit;
  }

  async runsForCommit(sha) {
    const r = await this.request(`/actions/runs?head_sha=${sha}&per_page=10`);
    return r.workflow_runs ?? [];
  }
}

export async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const hash = await crypto.subtle.digest("SHA-1", all);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

function explain(status, msg, hasToken) {
  if (status === 401) return "Token GitHub tidak valid atau sudah kedaluwarsa. Buat token baru di Pengaturan.";
  if (status === 403 && /rate limit/i.test(msg)) return "Batas akses GitHub tanpa token tercapai. Isi token di Pengaturan, atau coba lagi dalam 1 jam.";
  if (status === 403) return `Token tidak punya izin untuk tindakan ini (${msg}). Pastikan izin "Contents: Read and write" untuk repo ini.`;
  if (status === 404) return hasToken ? "Repo atau file tidak ditemukan. Periksa nama repo di Pengaturan." : "Repo atau file tidak ditemukan. Bila repo private, isi token di Pengaturan.";
  if (status === 409) return "Repo masih kosong atau sedang berubah. Coba lagi sebentar.";
  if (status === 422) return `GitHub menolak permintaan: ${msg}`;
  return `GitHub: ${msg}`;
}
