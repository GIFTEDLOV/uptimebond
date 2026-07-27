/**
 * Browser end-to-end smoke test with a MOCKED wallet.
 *
 * Drives the real UI in a headless browser against a running dev server. No
 * testnet GEN is ever spent: the injected wallet returns a fake deploy hash and
 * the app then tracks it as "submitted/pending" (the explorer never confirms a
 * fake hash), which is exactly the behaviour we want to verify without a live
 * write. Live-chain writes remain a separate, explicit manual pilot.
 *
 * Prereq: `npm run dev` (port 3000). Run: `node e2e/smoke.mjs`.
 * Exit code 0 = all checks passed.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const CUSTOMER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROVIDER = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';

const results = [];
const check = (name, cond) => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// EIP-1193 mock injected before any app code runs.
const mockWallet = (account) => `
window.ethereum = {
  isMetaMask: true,
  _acct: ${JSON.stringify(account)},
  request: async ({ method, params }) => {
    switch (method) {
      case 'eth_chainId': return '0x107d';               // 4221
      case 'eth_accounts': return window.ethereum._acct ? [window.ethereum._acct] : [];
      case 'eth_requestAccounts': return [window.ethereum._acct];
      case 'wallet_switchEthereumChain': return null;
      case 'wallet_addEthereumChain': return null;
      case 'eth_getTransactionCount': return '0x1';
      case 'eth_sendTransaction': return '0x' + 'e2e00000'.padEnd(64, '0');
      case 'eth_sendRawTransaction': return '0x' + 'e2e00000'.padEnd(64, '0');
      case 'eth_signTypedData_v4': return '0x' + '00'.repeat(65);
      case 'personal_sign': return '0x' + '00'.repeat(65);
      default: return null;
    }
  },
  on: () => {}, removeListener: () => {},
};
`;

async function newPage(browser, account) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(mockWallet(account));
  page.__errors = errors;
  return page;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

// 1. Landing renders and explains the product.
{
  const page = await newPage(browser, null);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  const h = await page.$eval('.hero-title', (e) => e.textContent).catch(() => '');
  check('landing shows hero headline', /keep their word/i.test(h));
  const sub = await page.$eval('.hero-sub', (e) => e.textContent).catch(() => '');
  check('landing states the proposition', /escrow/i.test(sub) && /validators/i.test(sub));
  check('landing lists all nav routes', (await page.$$('.mainnav .navlink')).length >= 5);
  check('landing has no console errors', page.__errors.length === 0);
  await page.close();
}

// 2. Wallet connect + role detection (customer) on a live demo contract.
{
  const page = await newPage(browser, CUSTOMER);
  await page.goto(`${BASE}/agreement/0x965C9B454867273F612BD48d181Ec418391750d5`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => /connect wallet/i.test(b.textContent) && b.click()));
  await new Promise((r) => setTimeout(r, 2500));
  const pill = await page.$eval('.pill', (e) => e.textContent).catch(() => '');
  check('wallet connects and shows the account pill', /0xf39F/i.test(pill));
  await new Promise((r) => setTimeout(r, 2500));
  const body = await page.evaluate(() => document.body.innerText);
  check('customer role is detected from live state', /customer/i.test(body));
  check('agreement page has no console errors', page.__errors.length === 0);
  await page.close();
}

// 3. Create wizard: connect, fill parties, advance through steps to Review.
{
  const page = await newPage(browser, CUSTOMER);
  await page.goto(`${BASE}/create`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => /connect wallet/i.test(b.textContent) && b.click()));
  await new Promise((r) => setTimeout(r, 1500));
  await page.type('input[placeholder="0x…"]', PROVIDER);
  const nextBtn = async () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.wizard-nav button')].find((x) => /next|continue/i.test(x.textContent));
    if (b && !b.disabled) { b.click(); return true; } return false;
  });
  check('step 1 valid after provider entered', await nextBtn());       // -> Service
  await new Promise((r) => setTimeout(r, 300));
  check('step 2 (service) advances', await nextBtn());                  // -> Evidence
  await new Promise((r) => setTimeout(r, 300));
  // Fill evidence URLs
  await page.evaluate((urls) => {
    const inputs = [...document.querySelectorAll('input[type=url]')];
    inputs.forEach((inp, i) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, urls[i]);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, [0,1,2,3].map((i) => `https://example.com/e${i}.json`));
  await new Promise((r) => setTimeout(r, 300));
  check('step 3 (evidence) advances with valid https URLs', await nextBtn()); // -> Settlement
  await new Promise((r) => setTimeout(r, 300));
  check('step 4 (settlement) advances with defaults', await nextBtn());       // -> Review
  await new Promise((r) => setTimeout(r, 300));
  const reviewText = await page.evaluate(() => document.body.innerText);
  check('reached review with the provider shown', /Review/i.test(reviewText) && /0x06BB/i.test(reviewText));
  check('create wizard has no console errors', page.__errors.length === 0);
  await page.close();
}

// 4. Wrong-network banner when the wallet is on another chain.
{
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(`
    window.ethereum = { isMetaMask:true, request: async ({method}) => method==='eth_chainId'?'0x1':(method.includes('ccount')?['${CUSTOMER}']:null), on:()=>{}, removeListener:()=>{} };
  `);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  const body = await page.evaluate(() => document.body.innerText);
  check('wrong-network banner shown off Bradbury', /wrong network/i.test(body));
  await page.close();
}

// 5. Invalid import is rejected.
{
  const page = await newPage(browser, CUSTOMER);
  await page.goto(`${BASE}/agreements`, { waitUntil: 'networkidle2' });
  await page.type('input[aria-label="Contract address to import"]', '0x1234');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Import')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const err = await page.evaluate(() => document.querySelector('.notice.error')?.textContent ?? '');
  check('invalid import address is rejected', /valid 0x/i.test(err));
  await page.close();
}

// 6. 404 route.
{
  const page = await newPage(browser, null);
  await page.goto(`${BASE}/does-not-exist`, { waitUntil: 'networkidle2' });
  check('404 page renders', /not found/i.test(await page.evaluate(() => document.body.innerText)));
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
