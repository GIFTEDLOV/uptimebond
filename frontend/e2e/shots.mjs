/**
 * Visual + hygiene sweep.
 *
 * Loads every route at a desktop and a mobile viewport, writes a full-page
 * screenshot for each, and reports console errors, failed requests, and any
 * horizontal overflow. Screenshots land in e2e/shots/ (git-ignored).
 *
 * Prereq: a server on port 3000 (`npm run dev` or `npm run preview`).
 * Run: `node e2e/shots.mjs`
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const LIVE_CASE = '0x965C9B454867273F612BD48d181Ec418391750d5';

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'create', path: '/create' },
  { name: 'agreements', path: '/agreements' },
  { name: 'agreement', path: `/agreement/${LIVE_CASE}` },
  { name: 'invite', path: `/invite/${LIVE_CASE}` },
  { name: 'demo', path: '/demo' },
  { name: 'help', path: '/help' },
  { name: 'privacy', path: '/privacy' },
  { name: 'terms', path: '/terms' },
  { name: 'diagnostics', path: '/diagnostics' },
  { name: 'notfound', path: '/no-such-page' },
];

const VIEWPORTS = [
  { tag: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { tag: 'mobile', width: 390, height: 844, dsf: 2, mobile: true },
];

const problems = [];
const note = (route, vp, kind, detail) => {
  problems.push({ route, vp, kind, detail });
  console.log(`  ! ${kind}: ${detail}`);
};

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const targets = ONLY.length ? ROUTES.filter((r) => ONLY.includes(r.name)) : ROUTES;

for (const vp of VIEWPORTS) {
  for (const route of targets) {
    const page = await browser.newPage();
    await page.setViewport({
      width: vp.width, height: vp.height,
      deviceScaleFactor: vp.dsf, isMobile: vp.mobile, hasTouch: vp.mobile,
    });

    const consoleErrors = [];
    const failed = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText ?? '';
      // Aborted chain reads on a slow testnet are not a page defect.
      if (err.includes('ERR_ABORTED')) return;
      failed.push(`${r.url()} — ${err}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.url()} — HTTP ${r.status()}`);
    });

    console.log(`${vp.tag} ${route.path}`);
    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) {
      note(route.name, vp.tag, 'navigation', String(e.message).slice(0, 160));
    }
    // Walk the page so scroll-triggered reveals fire, then return to the top —
    // otherwise a full-page capture records content that is still faded out.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
    });
    // Let reveal animations settle and chain reads land.
    await new Promise((r) => setTimeout(r, 2600));

    // --- horizontal overflow -------------------------------------------
    const overflow = await page.evaluate((vw) => {
      const doc = document.documentElement;
      const offenders = [];
      if (doc.scrollWidth > vw + 1) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            offenders.push(
              `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`
              + ` [${Math.round(r.left)}..${Math.round(r.right)}]`,
            );
          }
          if (offenders.length >= 6) break;
        }
      }
      return { scrollWidth: doc.scrollWidth, offenders };
    }, vp.width);
    if (overflow.scrollWidth > vp.width + 1) {
      note(route.name, vp.tag, 'overflow',
        `scrollWidth ${overflow.scrollWidth} > ${vp.width}: ${overflow.offenders.join(', ')}`);
    }

    // --- touch targets (mobile only) ------------------------------------
    if (vp.mobile) {
      const small = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('a, button, input, select, summary')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // WCAG 2.5.8 Target Size (Minimum), AA: 24 x 24 CSS pixels.
          if (r.height < 24) {
            bad.push(`${el.tagName.toLowerCase()}"${(el.textContent || '').trim().slice(0, 24)}" ${Math.round(r.height)}px`);
          }
          if (bad.length >= 8) break;
        }
        return bad;
      });
      if (small.length) note(route.name, vp.tag, 'touch-target', small.join('; '));
    }

    if (consoleErrors.length) note(route.name, vp.tag, 'console', consoleErrors.slice(0, 4).join(' | '));
    if (failed.length) note(route.name, vp.tag, 'request', [...new Set(failed)].slice(0, 4).join(' | '));

    await page.screenshot({
      path: join(OUT, `${route.name}-${vp.tag}.png`),
      fullPage: true,
    });
    // A viewport-sized crop too — full-page shots of the editorial routes are tall.
    await page.screenshot({ path: join(OUT, `${route.name}-${vp.tag}-fold.png`) });
    await page.close();
  }
}

// --- the zoom transition, sampled through its scroll range --------------
if (!ONLY.length || ONLY.includes('zoom')) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  const stage = await page.evaluate(() => {
    const el = document.querySelector('.zoom-stage');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height };
  });
  if (!stage) {
    note('home', 'desktop', 'zoom', 'no .zoom-stage found');
  } else {
    const span = stage.height - 900;
    for (const [i, f] of [0, 0.25, 0.5, 0.85].entries()) {
      await page.evaluate((y) => window.scrollTo(0, y), stage.top + span * f);
      await new Promise((r) => setTimeout(r, 500));
      const z = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.zoom-canvas')).getPropertyValue('--z').trim());
      console.log(`zoom frame ${i} (scroll ${Math.round(f * 100)}%) --z=${z}`);
      if (!z) note('home', 'desktop', 'zoom', `frame ${i}: --z never set`);
      await page.screenshot({ path: join(OUT, `zoom-${i}.png`) });
    }
  }
  await page.close();
}

await browser.close();

await writeFile(join(OUT, 'report.json'), JSON.stringify(problems, null, 2));
console.log(`\n${problems.length} problem(s) recorded → e2e/shots/report.json`);
process.exit(problems.length ? 1 : 0);
