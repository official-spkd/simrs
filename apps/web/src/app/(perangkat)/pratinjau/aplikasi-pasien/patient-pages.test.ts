import { patientAppHomeSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, runScenario } from '@/lib/demo/engine/run';
import { SCENARIOS } from '@/lib/demo/skenario';
import { applyLiveQueue, patientAppHome } from '@/lib/manajemen-aplikasi';
import { buildPatientPages } from './patient-pages';

const RJ = SCENARIOS['rawat-jalan'];

/** Beranda Tn. Suryo saat menunggu di Poli PD (langkah asesmen perawat aktif). */
function waitingAtPoli() {
  const jumped = advanceTo(
    RJ,
    [],
    RJ.steps.findIndex((s) => s.id === 'asesmen-perawat'),
  );
  if (!jumped.ok) throw new Error(jumped.error);
  return patientAppHomeSchema.parse(patientAppHome(runScenario(RJ, jumped.seq)));
}

describe('aplikasi pasien · posisi antrean hidup dari papan antrean', () => {
  it('jumlah di depan dan nomor dilayani mengikuti papan; notifikasi saat ≤ 3 dan saat giliran', () => {
    const home = waitingAtPoli();
    const q = home.queue;
    expect(q.stage).toBe('poli');
    const far = applyLiveQueue(home, { current: 'PD-020', waiting: ['PD-021', 'PD-022', 'PD-023', 'PD-024', q.number] });
    expect(far.queue).toMatchObject({ serving: 'PD-020', ahead: 4 });
    expect(far.notes).toEqual([]);
    const near = applyLiveQueue(home, { current: 'PD-023', waiting: ['PD-024', q.number] });
    expect(near.queue.ahead).toBe(1);
    expect(near.notes[0]).toMatchObject({ title: 'Antrean tersisa 1 pasien', tone: 'warning' });
    const turn = applyLiveQueue(home, { current: q.number, waiting: [] });
    expect(turn.queue).toMatchObject({ serving: q.number, ahead: 0 });
    expect(turn.notes[0]).toMatchObject({ title: 'Giliran Anda dipanggil', tone: 'danger' });
  });

  it('booking tersimpan tampil di Daftar berobat dan Jadwal', () => {
    const home = waitingAtPoli();
    const pages = buildPatientPages(home, [
      {
        code: 'BK-2610-041',
        patientId: 'p',
        slotId: 's',
        doctorId: 'd',
        doctorName: 'dr. Uji',
        poliCode: 'PD',
        poliName: 'Poli Penyakit Dalam',
        date: '2026-10-07',
        start: '08.00',
        jam: '10.50',
        cancelled: false,
        onLeave: false,
      },
    ]);
    expect(pages.daftar.rows.map((r) => r.value)).toContain('BK-2610-041');
    expect(pages.jadwal.rows.map((r) => r.value)).toContain('BK-2610-041');
  });
});
