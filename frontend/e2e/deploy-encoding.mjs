/**
 * Browser verification of the deploy calldata — MOCKED WALLET, NO GEN SPENT.
 *
 * Drives the real create wizard to the Deploy step and intercepts
 * `eth_sendTransaction` before anything is broadcast. The mock never forwards
 * the transaction anywhere, so this costs nothing and touches no chain.
 *
 * What it proves: the bundle the browser actually runs encodes `provider` as a
 * 20-byte GenVM Address, not as a 42-character hex string. That string
 * encoding is what killed deploy
 * 0x771ab1009b77fee8ee1d3e0422ec11045000af6f29d3b6b56123da0fe43d76b7 —
 * consensus accepted, execution failed, empty error.
 *
 * Prereq: a server on port 3000. Run: `node e2e/deploy-encoding.mjs`
 */
import puppeteer from 'puppeteer';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const CUSTOMER = '0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc';
const PROVIDER = '0x79DD8260773C7D5DEA701dfC2D3dD804FF041bf2';
const EV = 'https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/ad0018207edfba936b4074d3f1ccb5a2df58ac3b/evidence/case-002-partial-refund';
const URLS = [
  `${EV}/sla-terms.json`, `${EV}/monitor-report.json`,
  `${EV}/provider-status.json`, `${EV}/maintenance-announcements.json`,
];

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

// The transaction is captured and dropped. Nothing is ever broadcast.
await page.evaluateOnNewDocument(`
window.__captured = [];
window.ethereum = {
  isMetaMask: true,
  request: async ({ method, params }) => {
    switch (method) {
      case 'eth_chainId': return '0x107d';
      case 'eth_accounts': case 'eth_requestAccounts': return ['${CUSTOMER}'];
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'eth_getTransactionCount': return '0x1';
      case 'eth_estimateGas': return '0x5208';
      case 'eth_gasPrice': return '0x1';
      case 'eth_sendTransaction':
        window.__captured.push(params[0]);
        return '0x' + 'cafe'.padEnd(64, '0');
      default: return null;
    }
  },
  on: () => {}, removeListener: () => {},
};
`);

await page.goto(`${BASE}/create`, { waitUntil: 'networkidle2' });
await page.evaluate(() => document.querySelectorAll('button')
  .forEach((b) => /connect wallet/i.test(b.textContent) && b.click()));
await new Promise((r) => setTimeout(r, 1200));

const next = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.wizard-nav button')]
    .find((x) => /next|continue/i.test(x.textContent));
  if (b && !b.disabled) { b.click(); return true; }
  return false;
});
const setInputs = (selector, values) => page.evaluate((sel, vals) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  [...document.querySelectorAll(sel)].forEach((inp, i) => {
    if (vals[i] === undefined) return;
    setter.call(inp, vals[i]);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
}, selector, values);

await setInputs('input[placeholder="0x…"]', [PROVIDER]);
await new Promise((r) => setTimeout(r, 250));
check('step 1 accepts the provider address', await next());
await new Promise((r) => setTimeout(r, 250));
check('step 2 advances', await next());
await new Promise((r) => setTimeout(r, 250));
await setInputs('input[type=url]', URLS);
await new Promise((r) => setTimeout(r, 250));
// Each source must pass a live reachability test before the step advances.
await page.evaluate(() => [...document.querySelectorAll('button')]
  .filter((b) => /^(Test|Re-test)$/.test(b.textContent.trim())).forEach((b) => b.click()));
await new Promise((r) => setTimeout(r, 6000));
check('step 3 accepts the four tested evidence URLs', await next());
await new Promise((r) => setTimeout(r, 250));
check('step 4 advances with defaults', await next());
await new Promise((r) => setTimeout(r, 400));

// Step 5: tick the confirmation, continue to deploy.
await page.evaluate(() => {
  const cb = document.querySelector('.checkbox input[type=checkbox]');
  if (cb) cb.click();
});
await new Promise((r) => setTimeout(r, 250));
check('step 5 review confirms', await next());
await new Promise((r) => setTimeout(r, 500));

await page.evaluate(() => [...document.querySelectorAll('button')]
  .find((b) => /deploy agreement/i.test(b.textContent))?.click());
await new Promise((r) => setTimeout(r, 2500));

const captured = await page.evaluate(() => window.__captured);
check('a deploy transaction was built', captured.length > 0, `${captured.length} captured`);

if (captured.length) {
  const data = (captured[0].data || '').toLowerCase();
  const rawAddr = PROVIDER.slice(2).toLowerCase();               // 20 bytes, hex
  const asciiAddr = Buffer.from(PROVIDER, 'utf8').toString('hex'); // "0x79DD…" as chars

  check('provider present as 20 raw Address bytes', data.includes(rawAddr));
  check('provider NOT present as a 42-char ASCII string', !data.includes(asciiAddr.toLowerCase()));

  // The four URLs must still be there as ordinary strings, in order.
  let cursor = -1;
  let ordered = true;
  for (const u of URLS) {
    const at = data.indexOf(Buffer.from(u, 'utf8').toString('hex'));
    if (at <= cursor) ordered = false;
    cursor = at;
  }
  check('all four evidence URLs present and in order', ordered && cursor > 0);

  // 5000 and 86400 as ULEB128: 0x88 0xb8 0x02 / 0x80 0x98 0x2a with type bits.
  check('settlement integers present', /c1b802/.test(data) && /81982a/.test(data));
  check('no console errors during deploy', errors.length === 0, errors.slice(0, 2).join(' | '));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed — no GEN spent`);
process.exit(failed.length === 0 ? 0 : 1);
