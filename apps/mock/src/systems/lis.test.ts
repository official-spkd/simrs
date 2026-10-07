import { parseOru } from '@simrs/shared';
import { LIS_SIGNATURE_HEADER, LIS_TIMESTAMP_HEADER, verifyLisSignature } from '@simrs/shared/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type MockConfig } from '../config';
import { buildServer } from '../server';
import { MockState } from '../state';
import { LIS_TEMPLATE_OBSERVATIONS, LIS_TEMPLATES } from './lis';

/**
 * Fase 4 §4.1b · Kontrak mock analyzer LIS memakai parser + verifikasi tanda tangan SHARED (yang sama dengan endpoint
 * ingest SIM RS): ORU^R01 sah, barcode di OBR-3, tanpa PID, LOINC dari seed, skenario kritis/delta/tertunda, HMAC
 * perangkat, kirim ganda dengan MSH-10 sama, tanda tangan salah, barcode tak dikenal, latensi, ACK dibaca.
 */

let app: FastifyInstance;
let state: MockState;
let config: MockConfig;
let sent: Array<{ url: string; headers: Record<string, string>; body: string }>;

const SEED_LOINC = new Set([
  '1988-5',
  '2345-7',
  '2085-9',
  '718-7',
  '2823-3',
  '2075-0',
  '2093-3',
  '2160-0',
  '13457-7',
  '6690-2',
  '2951-2',
  '2571-8',
  '777-3',
  '3094-0',
]);

beforeEach(() => {
  sent = [];
  config = {
    ...loadConfig({ LIS_HL7_TARGET: 'http://127.0.0.1:4999/api/v1/devices/lis/hl7' }),
    sendWebhook: async (url, headers, body) => {
      sent.push({ url, headers, body });
      const controlId = parseOru(body).controlId;
      return {
        status: 200,
        body: `MSH|^~\\&|SIMRS|RS|||20261008100000||ACK^R01|ACK${controlId}|P|2.5\rMSA|AA|${controlId}`,
      };
    },
  };
  state = new MockState();
  app = buildServer(config, state);
});

afterEach(async () => {
  await app.close();
});

const send = (payload: object) => app.inject({ method: 'POST', url: '/_panel/api/lis/send', payload });

const verify = (s: { headers: Record<string, string>; body: string }, secret = config.lis.deviceSecret) =>
  verifyLisSignature({
    timestamp: s.headers[LIS_TIMESTAMP_HEADER] ?? '',
    signature: s.headers[LIS_SIGNATURE_HEADER] ?? '',
    rawBody: s.body,
    secret,
  });

describe('mock analyzer LIS (ORU^R01)', () => {
  it('normal: ORU sah dibaca parser shared, barcode OBR-3, tanpa PID, LOINC seed, token + HMAC perangkat, ACK', async () => {
    const res = await send({ barcode: 'l2610080001-01', template: 'kimia' });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(sent).toHaveLength(1);
    const s = sent[0] as (typeof sent)[number];
    expect(s.url).toBe('http://127.0.0.1:4999/api/v1/devices/lis/hl7');
    expect(s.headers.authorization).toBe(`Bearer ${config.lis.deviceToken}`);
    expect(s.headers['content-type']).toContain('application/hl7-v2');
    expect(verify(s)).toEqual({ ok: true });
    expect(s.body).not.toMatch(/(^|\r)PID\|/);
    const m = parseOru(s.body);
    expect(m.controlId).toBe(out.controlId);
    expect(m.sendingApplication).toBe('MOCK-ANALYZER');
    expect(m.orders).toHaveLength(1);
    expect(m.orders[0]?.specimenBarcode).toBe('L2610080001-01');
    const obs = m.orders[0]?.observations ?? [];
    expect(obs.map((o) => o.code)).toEqual(['2345-7', '3094-0', '2160-0', '1988-5']);
    expect(obs.every((o) => o.codeSystem === 'LN' && o.resultStatus === 'F' && o.numeric !== null)).toBe(
      true,
    );
    expect(state.lis.deliveries[0]).toMatchObject({
      status: 200,
      ack: 'AA',
      attempt: 1,
      signatureValid: true,
    });
  });

  it('semua templat hanya memakai LOINC dari SEED_REF_SAMPLES dan terbaca parser', async () => {
    for (const t of LIS_TEMPLATES) {
      expect(LIS_TEMPLATE_OBSERVATIONS[t].every((o) => SEED_LOINC.has(o.code))).toBe(true);
      await send({ barcode: `L${t.toUpperCase()}0001`, template: t });
    }
    expect(sent.map((s) => parseOru(s.body).orders[0]?.observations.length)).toEqual([3, 4, 3, 4]);
  });

  it('kritis: kalium 6,8 (ditambahkan bila templat tanpa kalium); delta kreatinin 2,4', async () => {
    await send({ barcode: 'L0000000001', template: 'elektrolit', scenario: 'kritis' });
    await send({ barcode: 'L0000000002', template: 'dl', scenario: 'kritis' });
    await send({ barcode: 'L0000000003', template: 'kimia', scenario: 'delta-kreatinin' });
    const k = (i: number) =>
      parseOru(sent[i]?.body ?? '').orders[0]?.observations.find((o) => o.code === '2823-3')?.numeric;
    expect(k(0)).toBe(6.8);
    expect(k(1)).toBe(6.8);
    const cr = parseOru(sent[2]?.body ?? '').orders[0]?.observations.find((o) => o.code === '2160-0');
    expect(cr?.numeric).toBe(2.4);
  });

  it('sebagian tertunda: separuh hasil status P tanpa nilai', async () => {
    await send({ barcode: 'L0000000004', template: 'lipid', scenario: 'sebagian-tertunda' });
    const obs = parseOru(sent[0]?.body ?? '').orders[0]?.observations ?? [];
    expect(obs.map((o) => o.resultStatus)).toEqual(['F', 'F', 'P', 'P']);
    expect(obs.slice(2).every((o) => o.value === '' && o.numeric === null)).toBe(true);
  });

  it('kirim ganda: dua pengiriman MSH-10 sama; tanda tangan salah gagal diverifikasi; barcode tak dikenal', async () => {
    await send({ barcode: 'L0000000005', template: 'dl', duplicate: true });
    expect(sent).toHaveLength(2);
    expect(parseOru(sent[0]?.body ?? '').controlId).toBe(parseOru(sent[1]?.body ?? '').controlId);
    expect(state.lis.deliveries.map((d) => d.attempt)).toEqual([2, 1]);

    await send({ barcode: 'L0000000006', template: 'dl', badSignature: true });
    expect(verify(sent[2] as (typeof sent)[number])).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(state.lis.deliveries[0]?.signatureValid).toBe(false);

    const r = await send({ barcode: 'L0000000007', template: 'dl', unknownBarcode: true });
    const bc = parseOru(sent[3]?.body ?? '').orders[0]?.specimenBarcode;
    expect(bc).toBe(r.json().barcode);
    expect(bc).not.toBe('L0000000007');
  });

  it('latensi ditunggu sebelum kirim; isian salah 400; reset mengosongkan riwayat', async () => {
    const t0 = Date.now();
    await send({ barcode: 'L0000000008', template: 'dl', latencyMs: 120 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
    expect((await send({ barcode: '<x>', template: 'dl' })).statusCode).toBe(400);
    expect((await send({ barcode: 'L0000000009', template: 'urin' })).statusCode).toBe(400);
    const st = await app.inject({ method: 'GET', url: '/_panel/api/state' });
    expect(st.json().lis.deliveries).toHaveLength(1);
    await app.inject({ method: 'POST', url: '/_panel/api/lis/reset' });
    expect(state.lis.deliveries).toHaveLength(0);
  });

  it('panel HTML memuat formulir kirim ORU', async () => {
    const html = (await app.inject({ method: 'GET', url: '/' })).body;
    expect(html).toContain('Analyzer laboratorium (HL7 ORU^R01)');
    expect(html).toContain("post('/_panel/api/lis/send'");
  });

  it('SIM RS tidak terjangkau: tercatat error tanpa ACK', async () => {
    config.sendWebhook = async () => ({ status: 'error' });
    await send({ barcode: 'L0000000010', template: 'dl' });
    expect(state.lis.deliveries[0]).toMatchObject({ status: 'error', ack: null });
  });
});
