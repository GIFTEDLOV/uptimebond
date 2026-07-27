/**
 * Accessibility scan.
 *
 * Runs axe-core (WCAG 2.0/2.1 A + AA rulesets) over every route at a desktop
 * and a mobile viewport, and additionally asserts the structural properties
 * axe cannot check on its own: a single H1, a reachable skip link, a visible
 * focus ring, and status indicators that do not rely on colour alone.
 *
 * Prereq: a server on port 3000. Run: `node e2e/a11y.mjs`
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const AXE_SOURCE = await readFile(require.resolve('axe-core'), 'utf8');

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const LIVE_CASE = '0x965C9B454867273F612BD48d181Ec418391750d5';

const ROUTES = [
  '/', '/create', '/agreements', `/agreement/${LIVE_CASE}`, `/invite/${LIVE_CASE}`,
  '/demo', '/help', '/privacy', '/terms', '/diagnostics', '/no-such-page',
];
const VIEWPORTS = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'mobile', width: 390, height: 844 },
];

let violations = 0;
let structural = 0;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2200));

    await page.evaluate(AXE_SOURCE);
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      });
      return r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
    });

    const struct = await page.evaluate(() => {
      const out = [];
      const h1s = document.querySelectorAll('h1');
      if (h1s.length !== 1) out.push(`h1 count is ${h1s.length}, expected 1`);
      if (!document.querySelector('a.skip-link[href="#main"]')) out.push('no skip link');
      if (!document.querySelector('main#main')) out.push('no main landmark with id=main');
      if (!document.querySelector('nav[aria-label]')) out.push('nav without an accessible name');
      // Status must never be conveyed by colour alone: every status chip,
      // payout badge and outcome dot needs a text label beside it.
      for (const el of document.querySelectorAll('.status-chip, .payout-badge, .payout-key')) {
        if (!el.textContent.trim()) out.push(`${el.className} has no text label`);
      }
      // Decorative-only marks must be hidden from assistive tech.
      for (const el of document.querySelectorAll('.sdot, .pb-dot, .oc-dot, .net, .empty-mark')) {
        if (el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden="true"]')) {
          out.push(`${el.className} is decorative but not aria-hidden`);
        }
      }
      return out;
    });

    // A visible focus ring on the first tabbable control.
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'nothing focused after Tab';
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      return ring ? null : `focused ${el.tagName.toLowerCase()} has no visible outline`;
    });
    if (focus) struct.push(focus);

    const label = `${vp.tag} ${route}`;
    if (res.length === 0 && struct.length === 0) {
      console.log(`PASS  ${label}`);
    } else {
      console.log(`FAIL  ${label}`);
      for (const v of res) {
        violations += 1;
        console.log(`   axe [${v.impact}] ${v.id}: ${v.help}\n        ${v.nodes.join(' | ')}`);
      }
      for (const s of struct) { structural += 1; console.log(`   structure: ${s}`); }
    }
    await page.close();
  }
}

await browser.close();
console.log(`\naxe violations: ${violations} · structural issues: ${structural}`);
process.exit(violations + structural === 0 ? 0 : 1);
