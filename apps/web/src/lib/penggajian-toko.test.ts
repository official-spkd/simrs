import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { PAYROLL_INPUTS } from './demo/fixtures/penggajian';
import { journalBalanced } from './penggajian';
import {
  initialPayroll,
  type PayrollEvent,
  payrollDomain,
  payrollJournalOf,
  postingEvent,
} from './penggajian-toko';

const when = '2026-10-05T03:50:00.000Z';
const akuntan = actor('u-akt', 'akuntan', 'Akuntan Uji');
const direktur = actor('u-dir', 'manajemen', 'Direktur Uji');
const pph = Object.fromEntries(PAYROLL_INPUTS.map((i) => [i.employeeId, String(i.pph21 ?? 100_000n)]));
const calc: PayrollEvent = { type: 'run.dihitung', pph, when };

describe('B05 · domain toko penggajian', () => {
  it('hitung wajib jasa pelayanan diimpor + PPh 21 lengkap; penyusun = pengguna sesi', () => {
    const s0 = initialPayroll();
    expect(denied(payrollDomain, s0, calc, akuntan)).toMatch(/Impor jasa pelayanan/);
    const s1 = applyAll(payrollDomain, [[{ type: 'jaspel.diimpor', when }, akuntan]]);
    const missing = { ...pph };
    delete missing[PAYROLL_INPUTS[3]?.employeeId ?? ''];
    expect(denied(payrollDomain, s1, { type: 'run.dihitung', pph: missing, when }, akuntan)).toMatch(
      /PPh 21 belum diisi untuk 1 pegawai/,
    );
    const s2 = applyAll(payrollDomain, [
      [{ type: 'jaspel.diimpor', when }, akuntan],
      [calc, akuntan],
    ]);
    expect(s2.stage).toBe(1);
    expect(s2.preparedBy?.name).toBe('Akuntan Uji');
  });

  it('penyetuju harus pengguna lain (ID sesi, termasuk posisi lain milik pengguna yang sama)', () => {
    const s = applyAll(payrollDomain, [
      [{ type: 'jaspel.diimpor', when }, akuntan],
      [calc, akuntan],
    ]);
    const approve: PayrollEvent = { type: 'run.disetujui', when };
    expect(denied(payrollDomain, s, approve, akuntan)).toMatch(/pemisahan tugas/);
    expect(denied(payrollDomain, s, approve, { ...direktur, userId: akuntan.userId })).toMatch(
      /pemisahan tugas/,
    );
    expect(denied(payrollDomain, s, approve, actor('u-x', 'perawat'))).toMatch(/Akuntan atau Manajemen/);
    expect(denied(payrollDomain, s, approve, direktur)).toBeNull();
  });

  it('posting = jurnal berpasangan seimbang; jurnal palsu ditolak; slip sekali', () => {
    const steps: Array<readonly [PayrollEvent, ReturnType<typeof actor>]> = [
      [{ type: 'jaspel.diimpor', when }, akuntan],
      [calc, akuntan],
      [{ type: 'run.disetujui', when }, direktur],
    ];
    const s = applyAll(payrollDomain, steps);
    expect(journalBalanced(payrollJournalOf(s))).toBe(true);
    const post = postingEvent(s, when);
    const forged = { ...post, journal: post.journal.map((j, i) => (i === 0 ? { ...j, debit: '1' } : j)) };
    expect(denied(payrollDomain, s, forged, akuntan)).toMatch(/tidak sesuai/);
    const posted = applyAll(payrollDomain, [
      ...steps,
      [post, akuntan],
      [{ type: 'slip.dikirim', jam: '11.00' }, akuntan],
    ]);
    expect(posted.stage).toBe(3);
    expect(posted.slipsSent?.by.name).toBe('Akuntan Uji');
    expect(denied(payrollDomain, posted, { type: 'slip.dikirim', jam: '11.01' }, akuntan)).toMatch(/sudah/);
  });
});
