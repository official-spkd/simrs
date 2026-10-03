import { describe, expect, it } from 'vitest';
import { bpjsDecryptResponse, bpjsEncryptResponse, bpjsSignature, verifyBpjsSignature } from './bpjs-crypto';
import { tpdiSignature, verifyTpdiWebhook } from './tpdi-signature';

const creds = { consId: '10000', secretKey: 'mock-secret' };

describe('BPJS', () => {
  it('tanda tangan deterministik dan terverifikasi', () => {
    const sig = bpjsSignature(creds, '1759500000');
    expect(sig).toBe(bpjsSignature(creds, '1759500000'));
    expect(verifyBpjsSignature(creds, '1759500000', sig)).toBe(true);
    expect(verifyBpjsSignature(creds, '1759500001', sig)).toBe(false);
  });

  it('enkripsi respons bolak-balik', () => {
    const data = { peserta: { noKartu: '0000000000001', statusPeserta: { keterangan: 'AKTIF' } } };
    const enc = bpjsEncryptResponse(data, creds, '1759500000');
    expect(enc).not.toContain('AKTIF');
    expect(bpjsDecryptResponse(enc, creds, '1759500000')).toEqual(data);
    expect(() => bpjsDecryptResponse(enc, creds, '1759500001')).toThrow();
  });
});

describe('TPDI webhook', () => {
  const secret = 'mock-tpdi-webhook-secret';
  const body = JSON.stringify({ event: 'payment.paid', amount: 1250400 });
  const now = new Date('2026-10-05T00:10:00Z');
  const ts = String(Math.floor(now.getTime() / 1000));

  it('menerima tanda tangan benar', () => {
    const signature = tpdiSignature(ts, body, secret);
    expect(verifyTpdiWebhook({ timestamp: ts, signature, rawBody: body, secret }, now)).toEqual({ ok: true });
  });

  it('menolak tanda tangan salah atau body diubah', () => {
    const signature = tpdiSignature(ts, body, secret);
    expect(verifyTpdiWebhook({ timestamp: ts, signature, rawBody: body + ' ', secret }, now)).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
    expect(verifyTpdiWebhook({ timestamp: ts, signature: 'zz', rawBody: body, secret }, now).ok).toBe(false);
  });

  it('menolak timestamp lebih dari 5 menit', () => {
    const old = String(Math.floor(now.getTime() / 1000) - 301);
    const signature = tpdiSignature(old, body, secret);
    expect(verifyTpdiWebhook({ timestamp: old, signature, rawBody: body, secret }, now)).toEqual({
      ok: false,
      reason: 'TIMESTAMP_EXPIRED',
    });
  });
});
