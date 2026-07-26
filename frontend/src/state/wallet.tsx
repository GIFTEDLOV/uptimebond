/** Wallet + network context.
 *
 * Holds the connected account and chain, reacts to wallet events
 * (accountsChanged / chainChanged), and exposes connect / disconnect / switch.
 * The app is fully readable with no wallet — everything here is optional, and a
 * connected wallet is never assumed to be a party to any agreement until a live
 * contract read confirms the address (that check lives in the agreement view). */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import {
  connectWallet, currentChainId, getInjected, switchToBradbury, type Eip1193,
} from '../chain';
import { CHAIN_ID } from '../config';

interface WalletCtx {
  provider: Eip1193 | null;
  hasWallet: boolean;
  account: string | null;
  chainId: number | null;
  wrongChain: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const provider = useMemo(() => getInjected(), []);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Passive: read the current chain if a wallet is present, without prompting.
  useEffect(() => {
    if (!provider) return;
    let alive = true;
    void (async () => {
      try {
        const id = await currentChainId(provider);
        if (alive) setChainId(id);
        // Reflect an already-authorized account without forcing a prompt.
        const accts = (await provider.request({ method: 'eth_accounts' })) as string[];
        if (alive && accts?.[0]) setAccount(accts[0]);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    const onAcct = (...a: unknown[]) => setAccount(((a[0] as string[]) ?? [])[0] ?? null);
    const onChain = (...a: unknown[]) => {
      const raw = a[0];
      const id = typeof raw === 'string' ? parseInt(raw, 16) : Number(raw);
      setChainId(Number.isFinite(id) ? id : null);
    };
    provider.on?.('accountsChanged', onAcct);
    provider.on?.('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAcct);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    setError(null);
    if (!provider) {
      setError('No EVM wallet detected. Install MetaMask (or another EIP-1193 wallet) to act as a party. You can still browse everything in read-only mode.');
      return;
    }
    setConnecting(true);
    try {
      const accts = await connectWallet(provider);
      setAccount(accts[0] ?? null);
      const id = await currentChainId(provider);
      setChainId(id);
      if (id !== CHAIN_ID) {
        try { await switchToBradbury(provider); setChainId(await currentChainId(provider)); }
        catch { /* user can switch manually via the banner */ }
      }
    } catch (e) {
      const err = e as { code?: number; message?: string };
      setError(err.code === 4001 ? 'Connection request was rejected in the wallet.' : (err.message ?? String(e)));
    } finally {
      setConnecting(false);
    }
  }, [provider]);

  const disconnect = useCallback(() => {
    // EIP-1193 has no programmatic disconnect; drop local state so the UI
    // returns to observer mode. The wallet keeps its own permission grant.
    setAccount(null);
    setError(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!provider) return;
    setError(null);
    try { await switchToBradbury(provider); setChainId(await currentChainId(provider)); }
    catch (e) {
      const err = e as { code?: number; message?: string };
      if (err.code !== 4001) setError(err.message ?? 'Could not switch network.');
    }
  }, [provider]);

  const value: WalletCtx = {
    provider, hasWallet: !!provider, account, chainId,
    wrongChain: chainId !== null && chainId !== CHAIN_ID,
    connecting, error, connect, disconnect, switchNetwork,
    clearError: () => setError(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWallet must be used within WalletProvider');
  return c;
}
