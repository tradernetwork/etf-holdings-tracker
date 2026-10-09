// 1024x500 Play feature graphic. Run: PW_FROM=... CHROMIUM=/usr/bin/chromium node feature.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(process.env.PW_FROM || import.meta.url)("playwright");
const D = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(D, "feature-graphic.template.html"), "utf8")
  .replace("__ICON__", readFileSync(path.join(D, "icon-512.png")).toString("base64"));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1024, height: 500 } });
await p.setContent(html);
await p.screenshot({ path: path.join(D, "feature-graphic.png") });
await b.close();
