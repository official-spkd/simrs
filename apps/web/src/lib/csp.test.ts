import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from './csp';

/** Arahan `script-src` dari sebuah CSP. */
const scriptSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('script-src ')) ?? '';

describe('CSP ber-nonce (ADR-0073)', () => {
  it('nonce baru tiap permintaan, 128 bit base64', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(a)).toHaveLength(16);
  });

  it('produksi: skrip hanya ber-nonce + strict-dynamic, tanpa unsafe-inline/unsafe-eval', () => {
    const csp = contentSecurityPolicy('abc123==', { dev: false });
    expect(scriptSrc(csp)).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // Gaya inline tetap diizinkan (atribut style React); skrip inline tidak.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(scriptSrc(csp)).not.toContain('unsafe-inline');
  });

  it('pengembangan: unsafe-eval dan websocket untuk HMR, tetap tanpa skrip unsafe-inline', () => {
    const csp = contentSecurityPolicy('n', { dev: true });
    expect(scriptSrc(csp)).toBe("script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });
});
