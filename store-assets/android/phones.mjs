// Play listing screenshots from the live site: 1080x1920 (360x640 @3x).
// Run: PW_FROM=/path/to/some/package.json CHROMIUM=/usr/bin/chromium node phones.mjs
// (PW_FROM = any package.json whose node_modules has `playwright`)
import { createRequire } from "module";
const { chromium } = createRequire(process.env.PW_FROM || import.meta.url)("playwright");
import path from "path";
import { fileURLToPath } from "url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.SITE || "https://tickertrace.pro";
const SHOTS = [
  ["phone-1", "/dashboard"],
  ["phone-2", "/changes"],
  ["phone-3", "/funds"],
  ["phone-4", "/stocks/NVDA"],
  ["phone-5", "/income"],
  ["phone-6", "/holdings"],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({
  viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  colorScheme: "dark", userAgent: undefined,
});
const page = await ctx.newPage();
for (const [name, route] of SHOTS) {
  await page.goto(SITE + route, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => console.log("nav", route, e.message.split("\n")[0]));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, name + ".png") });
  console.log("shot", name, route, "|", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 120));
}
await browser.close();
