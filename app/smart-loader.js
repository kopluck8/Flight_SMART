// Memuat model SMART dari file pilihan pengguna (paket SMART Mobile .zip, ekspor
// Configurable Model .zip/.xml, atau patrol_metadata.json) dan menyimpannya di perangkat.

import { unzipSync, strFromU8 } from "fflate";
import { store, toast, pickFiles } from "./ui.js";
import { parseConfigurableModel, parsePatrolMetadata } from "./smart.js";

export async function loadSmartFromFiles(ctx) {
  const picked = await pickFiles({ accept: ".zip,.xml,.json" });
  if (!picked.length) return false;
  const saved = { ...(store.get("fs.smart", {}) ?? {}) };
  const found = [];
  try {
    for (const file of picked) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = /\.zip$/i.test(file.name)
        ? unzipSync(bytes, { filter: (f) => /(\.xml|patrol_metadata\.json|project\.json)$/i.test(f.name) && !f.name.includes("/") })
        : { [file.name]: bytes };
      for (const [name, data] of Object.entries(entries)) {
        const txt = strFromU8(data);
        if (/\.xml$/i.test(name) && txt.includes("<ConfigurableModel")) {
          const model = parseConfigurableModel(txt);
          saved.cmXml = txt;
          found.push(`model "${model.name}"`);
        } else if (/\.json$/i.test(name) && txt.includes("SMART_PatrolTransport")) {
          const raw = JSON.parse(txt);
          const meta = parsePatrolMetadata(raw);
          saved.metadata = raw;
          found.push(`metadata patroli (${meta.employees.length} petugas)`);
        } else if (/project\.json$/i.test(name)) {
          saved.project = JSON.parse(txt);
          found.push("info proyek");
        }
      }
    }
  } catch (e) {
    toast(`File tidak bisa dibaca: ${e.message}`, "error");
    return false;
  }
  if (!found.length) {
    toast("Tidak ada cm_model.xml atau patrol_metadata.json di file itu.", "error");
    return false;
  }
  if (!store.set("fs.smart", saved)) {
    toast("Penyimpanan peramban penuh; model tidak tersimpan.", "error");
    return false;
  }
  ctx.loadSmart();
  toast(`Dimuat: ${found.join(", ")}.`);
  return true;
}
