import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { demoLabSamples } from './demo/fixtures/penunjang';
import { PRESET_MESSAGES, PROCESSED_TODAY } from './demo/fixtures/integrasi-perangkat';
import { parseOru, processInbound, redactPid, type Specimen } from './integrasi-perangkat';

const loinc = new Set(SEED_REF_SAMPLES.loinc.map((c) => c.code));
const specimens: Specimen[] = demoLabSamples().map((s) => ({
  labNo: s.labNo,
  patientName: s.patient.name,
  received: s.receivedAt !== null,
}));
const raw = (id: string) => PRESET_MESSAGES.find((m) => m.id === id)?.raw ?? '';
const run = (id: string, processed: ReadonlySet<string> = new Set(PROCESSED_TODAY)) =>
  processInbound(raw(id), specimens, processed, loinc);

describe('device gateway HL7', () => {
  it('parser ORU^R01: control ID, nomor lab, OBX ber-LOINC dari seed', () => {
    const p = parseOru(raw('pm-1'));
    if (!p.ok) throw new Error(p.reason);
    expect(p.msg).toMatchObject({
      controlId: 'HEM-261005-0418',
      device: 'HEMA-01',
      accession: 'L2610050163',
    });
    expect(p.msg.observations.map((o) => o.loinc)).toEqual(['718-7', '6690-2', '777-3']);
    for (const m of PRESET_MESSAGES) {
      const q = parseOru(m.raw);
      if (q.ok) for (const o of q.msg.observations) expect(loinc.has(o.loinc), o.loinc).toBe(true);
    }
    expect(parseOru('MSH|^~\\&|X|Y|Z|W|1||ADT^A01|1|P|2.5.1')).toEqual({
      ok: false,
      reason: 'Jenis pesan ADT^A01 bukan ORU^R01',
    });
  });

  it('cocok → AA draf; sampel belum diterima / nomor lab asing → AE; control ID ganda → idempoten', () => {
    expect(run('pm-1')).toMatchObject({ ack: 'AA', status: 'dicocokkan' });
    expect(run('pm-1').text).toContain('draf');
    expect(run('pm-3')).toMatchObject({ ack: 'AE', status: 'ditolak' });
    expect(run('pm-3').text).toContain('belum diterima');
    expect(run('pm-4').text).toContain('tidak dikenal');
    expect(run('pm-1', new Set(['HEM-261005-0418']))).toMatchObject({ ack: 'AA', status: 'duplikat' });
    expect(processInbound('bukan hl7', specimens, new Set(), loinc).ack).toBe('AR');
  });

  it('PID disamarkan sebelum disimpan', () => {
    expect(redactPid(raw('pm-1'))).toContain('PID|||•••');
    expect(redactPid(raw('pm-1'))).not.toContain('00-31-77-02');
  });
});
