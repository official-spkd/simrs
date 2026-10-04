import { doctorAppInboxSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from '@/lib/demo/engine/run';
import type { ScenarioEvent } from '@/lib/demo/engine/types';
import { SCENARIOS } from '@/lib/demo/skenario';
import { doctorAppInbox, hartonoLabOrdered } from '@/lib/manajemen-aplikasi';
import { buildDoctorPages, criticalDetailRow, criticalPendingText } from './doctor-pages';

const IGD = SCENARIOS['igd-ranap'];

/** Lompat ke langkah `stepId`, lalu jalankan `tasks` tugas berikutnya dengan nilai bawaan. */
function at(stepId: string, tasks = 0): ScenarioEvent[] {
  const jumped = advanceTo(
    IGD,
    [],
    IGD.steps.findIndex((s) => s.id === stepId),
  );
  if (!jumped.ok) throw new Error(jumped.error);
  let seq = jumped.seq;
  for (let i = 0; i < tasks; i++) {
    const r = applyAction(IGD, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  return seq;
}

function view(seq: ScenarioEvent[], accepted: string | null = null) {
  const R = runScenario(IGD, seq);
  const d = doctorAppInboxSchema.parse(doctorAppInbox(R));
  const labOrdered = hartonoLabOrdered(R);
  const pages = buildDoctorPages(d, { accepted, labOrdered, cosignLeft: 3, nextCosign: null });
  return {
    c: d.critical,
    labOrdered,
    task: pages.tugas.rows.find((r) => r.id === 'kritis'),
    row: criticalDetailRow(d.critical, accepted, labOrdered),
    card: criticalPendingText(d.critical, labOrdered),
  };
}

describe('nilai kritis di aplikasi dokter mengikuti order → hasil → read-back', () => {
  it('sebelum order lab: "belum ada order", tanpa analit, nilai, atau nama pasien', () => {
    for (const seq of [at('kedatangan', 1), at('asesmen-dokter', 1)]) {
      const v = view(seq);
      expect(v.task).toMatchObject({
        detail: 'Belum ada order lab yang menunggu hasil',
        status: 'Belum ada',
        tone: 'muted',
      });
      expect(v.card).toBe('Belum ada order lab yang menunggu hasil.');
      expect(v.row).toEqual({ label: 'Hasil lab', value: 'Belum ada order lab', danger: false });
      expect(JSON.stringify([v.task, v.card, v.row])).not.toMatch(/6,8|Kalium|Hartono/);
    }
  });

  it('order terkirim, hasil belum keluar: "sedang diproses" tanpa nilai', () => {
    const v = view(at('asesmen-dokter', 2));
    expect(v.labOrdered).toBe(true);
    expect(v.task).toMatchObject({
      detail: 'Hasil lab Tn. Hartono Wibisono sedang diproses',
      status: 'Diproses',
      tone: 'muted',
    });
    expect(v.card).toMatch(/sedang diproses/);
    expect(v.row).toMatchObject({ label: 'Hasil lab', value: 'Order terkirim · hasil sedang diproses' });
    expect(JSON.stringify([v.task, v.card, v.row])).not.toMatch(/6,8|Kalium/);
  });

  it('hasil keluar: nilai tampil dan bertanda kritis sampai read-back', () => {
    const v = view(at('nilai-kritis', 1));
    expect(v.c.state).toBe('menunggu-laporan');
    expect(v.task).toMatchObject({
      detail: 'Kalium 6,8 · Tn. Hartono Wibisono',
      status: 'Belum diterima',
      tone: 'bad',
    });
    expect(v.row).toMatchObject({ label: 'Kalium', danger: true });
  });

  it('read-back diterima (pratinjau lokal): status hijau dengan jam penerimaan', () => {
    const v = view([], '10.47');
    expect(v.task).toMatchObject({ status: 'Diterima 10.47', tone: 'ok' });
    expect(v.row).toMatchObject({ label: 'Kalium', danger: false });
    expect(v.row.value).toMatch(/diterima 10\.47/);
  });
});
