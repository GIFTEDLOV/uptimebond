import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Evidence sources are fixed at deployment and decide every future ruling. A
 * URL that 404s guarantees a failed adjudication, and nobody can change it
 * afterwards.
 *
 * The wizard used to advance on syntax alone, and stored test results without
 * the URL that produced them — so typing a good URL, pressing Test, then
 * editing one character left the step showing a green HTTP 200 for a URL that
 * had never been fetched.
 */

const CUSTOMER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROVIDER = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';

import type { EvidenceResult } from '../lib/evidence';

const fetchEvidence = vi.fn(async (url: string): Promise<EvidenceResult> => ({
  ok: true, status: 200, kind: 'json', url, preview: '{}',
}));

vi.mock('../state/wallet', () => ({
  useWallet: () => ({
    account: CUSTOMER, provider: {}, hasWallet: true, wrongChain: false,
    connecting: false, error: null, chainId: 4221,
    connect: vi.fn(), disconnect: vi.fn(), switchNetwork: vi.fn(), clearError: vi.fn(),
  }),
}));
vi.mock('../lib/evidence', () => ({ fetchEvidence: (u: string) => fetchEvidence(u) }));
vi.mock('../chain', async (orig) => ({
  ...(await orig<typeof import('../chain')>()),
  deployContract: vi.fn(), pollTx: vi.fn(async () => ({ phase: 'submitted' as const })),
}));

const { Create } = await import('./Create');

const URLS = [
  'https://example.com/sla.json', 'https://example.com/monitor.json',
  'https://example.com/status.json', 'https://example.com/maint.json',
];

const renderWizard = () => render(<MemoryRouter><Create /></MemoryRouter>);

const nextButton = () => screen.getAllByRole('button')
  .find((b) => /^(Next|Continue to deploy)$/.test(b.textContent ?? '')) as HTMLButtonElement;

/** Walk to the evidence step with the parties and service steps satisfied. */
const toEvidenceStep = async () => {
  renderWizard();
  fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: PROVIDER } });
  await waitFor(() => expect(nextButton().disabled).toBe(false));
  fireEvent.click(nextButton());               // -> Service
  await waitFor(() => expect(nextButton().disabled).toBe(false));
  fireEvent.click(nextButton());               // -> Evidence
  await screen.findByText(/Evidence sources/i);
};

const urlInputs = () => screen.getAllByPlaceholderText('https://…') as HTMLInputElement[];
const testButtons = () => screen.getAllByRole('button')
  .filter((b) => /^(Test|Re-test)$/.test(b.textContent ?? '')) as HTMLButtonElement[];

beforeEach(() => {
  localStorage.clear();
  fetchEvidence.mockClear();
});

describe('evidence step requires a current successful test for every source', () => {
  it('does not advance on syntactically valid but untested URLs', async () => {
    await toEvidenceStep();
    urlInputs().forEach((input, i) => fireEvent.change(input, { target: { value: URLS[i] } }));
    await waitFor(() => expect(screen.getAllByText(/Not tested yet/i).length).toBe(4));
    expect(nextButton().disabled).toBe(true);
  });

  it('advances once all four are tested successfully', async () => {
    await toEvidenceStep();
    urlInputs().forEach((input, i) => fireEvent.change(input, { target: { value: URLS[i] } }));
    testButtons().forEach((b) => fireEvent.click(b));
    await waitFor(() => expect(fetchEvidence).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(nextButton().disabled).toBe(false));
  });

  it('editing a tested URL invalidates its HTTP 200 result', async () => {
    await toEvidenceStep();
    urlInputs().forEach((input, i) => fireEvent.change(input, { target: { value: URLS[i] } }));
    testButtons().forEach((b) => fireEvent.click(b));
    await waitFor(() => expect(nextButton().disabled).toBe(false));

    // One character changes on the monitor URL — the primary evidence source.
    fireEvent.change(urlInputs()[1], { target: { value: 'https://example.com/monitorX.json' } });

    await waitFor(() => expect(nextButton().disabled).toBe(true));
    expect(screen.getAllByText(/Not tested yet/i).length).toBe(1);
    // The stale success must not still be on screen for that field.
    expect(screen.getAllByText(/HTTP 200/i).length).toBe(3);
  });

  it('a failing source blocks the step', async () => {
    await toEvidenceStep();
    urlInputs().forEach((input, i) => fireEvent.change(input, { target: { value: URLS[i] } }));
    fetchEvidence.mockImplementationOnce(async (url: string): Promise<EvidenceResult> => ({
      ok: false, status: 404, kind: 'text', url, error: 'HTTP 404',
    }));
    testButtons().forEach((b) => fireEvent.click(b));
    await waitFor(() => expect(fetchEvidence).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByText(/HTTP 404/i)).toBeTruthy());
    expect(nextButton().disabled).toBe(true);
  });
});
