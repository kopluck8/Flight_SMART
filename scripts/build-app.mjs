#!/usr/bin/env node
// Merakit aplikasi web (app/) menjadi satu file index.html di akar repo: JavaScript, CSS,
// peta, dan model SMART tertanam, sehingga bisa disajikan GitHub Pages atau dibuka langsung
// dari komputer tanpa server.
//
//   node scripts/build-app.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DOMParser } from "@xmldom/xmldom";
import { parseConfigurableModel } from "../app/smart.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = (p) => `${root}${p}`;
const read = (p) => readFileSync(path(p), "utf8");

const bundle = async (entry, options = {}) => {
  const out = await build({ entryPoints: [path(entry)], bundle: true, minify: true, write: false, legalComments: "none", logLevel: "warning", ...options });
  return out.outputFiles[0].text.trim();
};

const js = await bundle("app/main.js", { format: "iife", target: ["es2020"], platform: "browser" });
const css = await bundle("app/style.css", { loader: { ".png": "dataurl", ".svg": "dataurl" } });

const model = parseConfigurableModel(read("data/smart/cm_model.xml"), new DOMParser());
const data = {
  smart: {
    model,
    metadata: JSON.parse(read("data/smart/patrol_metadata.public.json")),
    project: JSON.parse(read("data/smart/project.json")),
  },
};

// Aman di dalam <script>: tidak ada "</script" atau "<!--" yang bisa menutup tag lebih awal.
const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const safeJs = js.replace(/<\/(script)/gi, "<\\/$1");
if (/<!--|<script/i.test(safeJs)) throw new Error("Bundle JS memuat '<!--' atau '<script' yang tidak aman di dalam tag <script>.");
const safeCss = css.replace(/<\/(style)/gi, "<\\/$1");

const html = read("app/index.html")
  .replace("/*__CSS__*/", () => safeCss)
  .replace("/*__DATA__*/", () => json)
  .replace("/*__JS__*/", () => safeJs);

writeFileSync(path("index.html"), html);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`index.html ${kb(html)} (JS ${kb(js)}, CSS ${kb(css)}, model SMART ${kb(json)}: ${model.name})`);
