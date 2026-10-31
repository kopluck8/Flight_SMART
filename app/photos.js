// Membaca metadata foto drone (EXIF + XMP DJI) dan menyiapkan gambar untuk ekspor SMART.

import exifr from "exifr";

const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

/** "2026:10:26 09:00:20" + offset menit -> epoch ms (UTC). */
export function exifTimeToMs(text, tzMin, subSec, offsetText) {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text ?? ""));
  if (!m) return null;
  const ms = subSec ? Number(`0.${String(subSec).replace(/\D/g, "")}`) * 1000 : 0;
  let offset = tzMin;
  const o = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offsetText ?? "").trim());
  if (o) offset = (o[1] === "-" ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3]));
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.round(ms)) - offset * 60000;
}

export async function readPhotoMeta(file, tzMin) {
  let tags = {};
  try {
    tags = (await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, mergeOutput: false, reviveValues: false, translateValues: false })) ?? {};
  } catch {
    tags = {};
  }
  const exif = tags.exif ?? {};
  const gps = tags.gps ?? {};
  const dji = tags["drone-dji"] ?? {};
  const time = exif.DateTimeOriginal ?? exif.CreateDate ?? tags.ifd0?.ModifyDate;
  let ms = exifTimeToMs(time, tzMin, exif.SubSecTimeOriginal, exif.OffsetTimeOriginal);
  if (ms === null && file.lastModified) ms = file.lastModified;
  const lat = num(gps.latitude ?? dji.GpsLatitude ?? dji.Latitude);
  const lon = num(gps.longitude ?? dji.GpsLongitude ?? dji.GpsLongtitude ?? dji.Longitude);
  const hasGps = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  return {
    ms,
    timeSource: time ? "exif" : "file",
    lat: hasGps ? lat : null,
    lon: hasGps ? lon : null,
    alt: num(dji.AbsoluteAltitude) ?? num(gps.GPSAltitude),
    relAlt: num(dji.RelativeAltitude),
    gimbalPitch: num(dji.GimbalPitchDegree),
    gimbalYaw: num(dji.GimbalYawDegree),
    flightYaw: num(dji.FlightYawDegree),
    camera: [tags.ifd0?.Make, tags.ifd0?.Model].filter(Boolean).join(" "),
  };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(bitmap, maxSide) {
  const w = bitmap.width, h = bitmap.height;
  const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(w, h)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function makeThumbnail(file, maxSide = 360) {
  const bmp = await loadBitmap(file);
  const canvas = drawScaled(bmp, maxSide);
  bmp.close?.();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ""), "image/jpeg", 0.8));
}

/** JPEG base64 (tanpa prefiks data:) untuk SMART_Photo. maxSide 0 = ukuran asli tanpa diubah. */
export async function photoBase64(file, maxSide = 1600, quality = 0.85) {
  if (!maxSide) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const bmp = await loadBitmap(file);
  const canvas = drawScaled(bmp, maxSide);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}
