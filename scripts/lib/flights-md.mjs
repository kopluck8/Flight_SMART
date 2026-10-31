// Membuat FLIGHTS.md: tabel penerbangan dengan tautan unduhan yang dirender GitHub.

const link = (path) => encodeURI(path).replace(/\(/g, "%28").replace(/\)/g, "%29");

const fmtDuration = (s) => {
  if (!Number.isFinite(s)) return "-";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} mnt` : `${m} mnt`;
};

const fmtDistance = (m) => (Number.isFinite(m) ? (m >= 1000 ? `${(m / 1000).toFixed(2).replace(".", ",")} km` : `${m} m`) : "-");

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderFlightsMarkdown(index) {
  const ok = index.flights.filter((f) => f.status === "ok");
  const failed = index.flights.filter((f) => f.status !== "ok");
  const totalSec = ok.reduce((a, f) => a + (f.durationSec || 0), 0);
  const totalM = ok.reduce((a, f) => a + (f.distanceM || 0), 0);
  const tzLabel = `${index.timezoneName ? index.timezoneName + ", " : ""}UTC${index.timezoneOffset}`;

  const lines = [
    "# Daftar Penerbangan",
    "",
    `File ini diperbarui otomatis setiap ada log baru di folder [\`logs/\`](logs/). Waktu dalam ${tzLabel}.`,
    "Klik **Peta** untuk melihat jalur terbang langsung di GitHub, atau klik nama format untuk mengunduh (tombol *Download raw file*).",
    "",
    `**${ok.length} penerbangan** · total ${fmtDuration(totalSec)} · ${fmtDistance(totalM)}`,
    "",
  ];

  if (ok.length) {
    lines.push(
      "| Waktu mulai | Pesawat | Durasi | Jarak | Tinggi maks | Foto | Unduh |",
      "|---|---|---:|---:|---:|---:|---|"
    );
    for (const f of ok) {
      const when = f.startLocal ? f.startLocal.replace("T", " ").slice(0, 16) : f.id;
      const dl = [
        `[Peta](${link(f.files.geojson)})`,
        `[GPX](${link(f.files.gpx)})`,
        `[KML](${link(f.files.kml)})`,
        `[CSV](${link(f.files.csv)})`,
        `[Log asli](${link(f.log)})`,
      ].join(" · ");
      lines.push(
        `| ${cell(when)} | ${cell(f.aircraft || "-")} | ${fmtDuration(f.durationSec)} | ${fmtDistance(f.distanceM)} | ${Number.isFinite(f.maxHeightM) ? `${Math.round(f.maxHeightM)} m` : "-"} | ${f.photos ?? 0} | ${dl} |`
      );
    }
    lines.push("");
  } else {
    lines.push("Belum ada penerbangan. Unggah file `DJIFlightRecord_*.txt` ke folder `logs/` untuk memulai.", "");
  }

  if (failed.length) {
    lines.push("## Gagal diproses", "", "| Log | Masalah |", "|---|---|");
    for (const f of failed) lines.push(`| [${cell(f.log)}](${link(f.log)}) | ${cell(f.error)} |`);
    lines.push("");
  }
  return lines.join("\n");
}
