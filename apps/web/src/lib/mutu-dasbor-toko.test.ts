import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { dashboardAlertKey, dashboardDomain } from './dasbor-toko';
import { project, type StoredEvent } from './demo/store/define';
import { qualityDomain } from './mutu-toko';
import { resumeOnTime } from './mutu-transaksi';

const dpjp = actor('u-dpjp', 'dokter', 'dr. DPJP Uji');
const at = '2026-10-05T03:50:00.000Z';

describe('B06 · domain toko mutu', () => {
  it('melanggan resume final (resume ≤ 24 jam) dan kematian IGD', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        domain: 'resume-medis',
        at,
        actor: dpjp,
        data: {
          type: 'resume.final',
          encounterId: 'enc-x',
          patientId: 'p-x',
          rm: '00-00-00-01',
          patientName: 'Pasien Uji',
          guarantor: 'Umum',
          admittedAt: '2026-10-01T08:00:00+07:00',
          dischargeAt: '2026-10-05T09:00:00+07:00',
          los: 4,
          dischargeMethod: 'Atas persetujuan dokter',
          condition: 'Membaik',
          dpjp: 'dr. DPJP Uji',
          codes: [{ system: 'ICD-10', code: 'J18.9', label: 'Pneumonia', primary: true }],
          signedAt: '2026-10-05T10:40:00+07:00',
        },
      },
      {
        seq: 2,
        domain: 'klinis-igd',
        at,
        actor: dpjp,
        data: {
          type: 'pasien.meninggal',
          encounterId: 'enc-y',
          patientId: null,
          patientName: 'Pasien IGD Uji',
          diedAt: '2026-10-05T10:40:00+07:00',
          causeCode: 'I21.4',
          causeLabel: 'Infark miokard akut',
          certificateNo: 'SKK/RSFA/0001',
          at,
        },
      },
    ];
    const s = project(qualityDomain, { seq: 2, resetSeq: 0, events }).state;
    expect(resumeOnTime(s.discharges)).toEqual({ within: 1, total: 1 });
    expect(s.deaths.map((d) => d.causeCode)).toEqual(['I21.4']);
  });
});

describe('I09 · domain toko dasbor', () => {
  it('tanda tindak lanjut hanya Manajemen; batal tanda mengembalikan', () => {
    const key = dashboardAlertKey({ id: 'icu', title: 'ICU 92%' });
    const mark = { type: 'alert.ditandai' as const, key, title: 'ICU 92%', jam: '10.00' };
    expect(denied(dashboardDomain, { acks: {} }, mark, actor('u-p', 'perawat'))).toMatch(/Manajemen/);
    const s = applyAll(dashboardDomain, [[mark, actor('u-d', 'manajemen', 'Direktur Uji')]]);
    expect(s.acks[key]?.by).toBe('Direktur Uji');
    const back = applyAll(dashboardDomain, [
      [mark, actor('u-d', 'manajemen')],
      [{ type: 'alert.dibatalkan', key, jam: '10.01' }, actor('u-d', 'manajemen')],
    ]);
    expect(back.acks[key]).toBeUndefined();
  });
});
