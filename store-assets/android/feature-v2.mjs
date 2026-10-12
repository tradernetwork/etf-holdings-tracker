// 1024x500 Play feature graphic, v2 copy (native app). Run from this folder:
//   PW=/path/to/playwright-core/index.mjs CHROMIUM=/usr/bin/chromium node feature-v2.mjs
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const { chromium } = await import(process.env.PW || "playwright-core");
const D = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(D, "feature-graphic.v2.template.html"), "utf8")
  .replace("__ICON__", readFileSync(path.join(D, "icon-512.png")).toString("base64"));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1024, height: 500 } });
await p.setContent(html);
await p.screenshot({ path: path.join(D, "v2", "feature-graphic.png") });
await b.close();
