/**
 * SHA-256 over the exact UTF-8 bytes of a string.
 *
 * Used to pin the contract source a deployment actually submitted, so
 * verification can prove the on-chain code is the code we sent rather than
 * trusting that the bundle contained what we expected. WebCrypto is available
 * in every browser this app supports and in Node 18+, so there is no fallback:
 * a missing SubtleCrypto should fail loudly, not silently skip the check.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
