import { patientAppHomeSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, runScenario } from '@/lib/demo/engine/run';
import { SCENARIOS } from '@/lib/demo/skenario';
import { patientAppHome } from '@/lib/manajemen-aplikasi';
import { buildPatientPages, queueNotification } from './patient-pages';

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

describe('aplikasi pasien · notifikasi antrean (mockup AppPasien "Maju")', () => {
  it('hanya saat tersisa 3 pasien dan saat giliran tiba', () => {
    const q = waitingAtPoli().queue;
    expect(q.stage).toBe('poli');
    // Di skenario hanya 1 pasien di depan Tn. Suryo: "Maju" langsung memicu notifikasi giliran.
    expect(q.ahead).toBe(1);
    expect(queueNotification(q, 4, '10.50')).toBeNull();
    expect(queueNotification(q, 3, '10.50')).toMatchObject({
      title: 'Antrean tersisa 3 pasien',
      detail: `${q.number} · silakan menuju ruang tunggu`,
      when: '10.50',
      tone: 'warning',
    });
    expect(queueNotification(q, 1, '10.57')).toBeNull();
    expect(queueNotification(q, 0, '11.04')).toMatchObject({
      title: 'Giliran Anda dipanggil',
      tone: 'danger',
    });
  });

  it('notifikasi antrean tampil paling atas di tab Notifikasi, sebelum notifikasi skenario', () => {
    const home = waitingAtPoli();
    const note = queueNotification(home.queue, 3, '10.50');
    if (!note) throw new Error('notifikasi tidak terbentuk');
    const rows = buildPatientPages(home, [note]).notif.rows;
    expect(rows[0]).toMatchObject({ title: 'Antrean tersisa 3 pasien', value: '10.50' });
    expect(rows).toHaveLength(home.feed.length + 1);
    expect(buildPatientPages(home).notif.rows).toHaveLength(home.feed.length);
  });
});
