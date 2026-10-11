// Play phone screenshots (1080x1920 = 360x640 @3x, Terminal and Paper) from the app's WEB EXPORT.
//   1. cd mobile && EXPO_PUBLIC_API_URL=<api, with CORS for the preview origin> OUT=/tmp/tt-play-web npm run export:web-preview
//   2. serve /tmp/tt-play-web under /previews/app (SPA fallback) on 127.0.0.1:8199
//   3. PW=/path/to/playwright-core/index.mjs node phones-v2.mjs   (writes ./shots/<name>-<theme>.png; the ticker
//      shot needs a ~40 s wait because /api/v1/stock/{ticker} is slow, see docs/PLAY_RELEASE.md)
// Follows are seeded through the web build's localStorage ("tt.follows") so the Following screen is populated.
import fs from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright-core');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d=>d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome`, args:['--no-sandbox'] });
const base = 'http://127.0.0.1:8199/previews/app';
const jobs = [
  ['01-today','/'],
  ['02-signals','/signals?tab=buys'],
  
  ['04-fund','/fund/ARKK'],
  ['05-following','/following'],
  ['06-options','/options'],
  ['07-effectiveness','/effectiveness'],
  ['08-explore','/explore'],
];
for (const [theme, scheme] of [['terminal','dark'],['paper','light']]) {
  const ctx = await browser.newContext({ viewport:{width:360,height:640}, deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme: scheme });
  await ctx.addInitScript(() => {
    localStorage.setItem('tt.follows', JSON.stringify([{kind:'ticker',symbol:'NVDA'},{kind:'ticker',symbol:'TSLA'},{kind:'fund',symbol:'ARKK'},{kind:'fund',symbol:'MSTY'}]));
    localStorage.setItem('tt.notify', JSON.stringify({asked:true,enabled:false,denied:false,awaitingBuild:false,token:null}));
  });
  for (const [name, path] of jobs) {
    const page = await ctx.newPage();
    page.on('pageerror', e=>console.log('PAGEERROR', name, e.message));
    await page.goto(base+path, { waitUntil:'load' }).catch(e=>console.log('goto',name,e.message));
    await page.waitForTimeout(6000);
    await page.screenshot({ path:`./shots/${name}-${theme}.png` });
    await page.close();
    console.log('shot', name, theme);
  }
  await ctx.close();
}
await browser.close();
