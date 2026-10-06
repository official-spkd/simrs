import { describe, expect, it } from 'vitest';
import type { RunResult } from './demo/engine/types';
import { demoCpoeAvailable } from './demo/fixtures/klinis';
import { encounterIdOf, patientById } from './demo/fixtures/pasien';
import { PATIENT_ID } from './demo/fixtures/ids';

const HARTONO_ID = PATIENT_ID.hartono;
import { WORKLIST_PATIENTS, WORKLIST_TASKS } from './demo/fixtures/rme-worklist';
import { DEMO_NOW } from './demo/fixtures/waktu';
import {
  completionBlocker,
  completionNote,
  dueLabel,
  formatDuration,
  isOverdue,
  readBackMatches,
  sortTasks,
  targetHref,
  type WorklistTask,
  worklistRole,
  worklistSummary,
} from './rme-worklist';
import { screenById } from './screens';

const task = (patch: Partial<WorklistTask>): WorklistTask => ({
  id: 't',
  kind: 'hasil-baru',
  priority: 'normal',
  encounterId: 'e',
  patientId: 'p',
  title: 'x',
  detail: 'y',
  createdAt: '2026-10-05T08:00:00+07:00',
  dueAt: null,
  action: { kind: 'tandai-dibaca' },
  target: null,
  ...patch,
});

describe('worklist klinis (K01)', () => {
  it('posisi klinis dikenali; posisi lain tanpa worklist', () => {
    expect(worklistRole('dokter')).toBe('dokter');
    expect(worklistRole('dokter_residen')).toBe('dokter_residen');
    expect(worklistRole('kasir')).toBeNull();
    expect(worklistRole(null)).toBeNull();
  });

  it('urutan: kritis, lalu lewat batas, lalu batas terdekat; tugas menunggu pihak lain di akhir', () => {
    const now = '2026-10-05T10:45:00+07:00';
    const list = [
      task({ id: 'rutin-nanti', dueAt: '2026-10-05T14:00:00+07:00' }),
      task({ id: 'menunggu', priority: 'kritis', waitingFor: 'DPJP' }),
      task({ id: 'tinggi-lewat', priority: 'tinggi', dueAt: '2026-10-05T10:30:00+07:00' }),
      task({ id: 'tinggi-nanti', priority: 'tinggi', dueAt: '2026-10-05T12:00:00+07:00' }),
      task({ id: 'kritis', priority: 'kritis', dueAt: '2026-10-05T11:09:00+07:00' }),
      task({ id: 'rutin-dekat', dueAt: '2026-10-05T11:00:00+07:00' }),
    ];
    expect(sortTasks(list, now).map((t) => t.id)).toEqual([
      'kritis',
      'tinggi-lewat',
      'tinggi-nanti',
      'rutin-dekat',
      'rutin-nanti',
      'menunggu',
    ]);
  });

  it('label tenggat bertulisan', () => {
    const now = '2026-10-05T10:45:00+07:00';
    expect(formatDuration(45)).toBe('45 mnt');
    expect(formatDuration(60)).toBe('1 jam');
    expect(formatDuration(135)).toBe('2 jam 15 mnt');
    expect(dueLabel(task({ dueAt: '2026-10-05T10:30:00+07:00' }), now)).toBe('Lewat 15 mnt');
    expect(dueLabel(task({ dueAt: '2026-10-05T12:00:00+07:00' }), now)).toBe('1 jam 15 mnt lagi');
    expect(dueLabel(task({}), now)).toBe('Tanpa batas waktu');
    expect(isOverdue(task({ dueAt: '2026-10-05T10:30:00+07:00' }), now)).toBe(true);
  });

  it('baca ulang nilai kritis: koma/titik setara, nilai lain ditolak', () => {
    expect(readBackMatches('6,4', '6,4')).toBe(true);
    expect(readBackMatches(' 6.4 ', '6,4')).toBe(true);
    expect(readBackMatches('4,6', '6,4')).toBe(false);
    expect(readBackMatches('', '6,4')).toBe(false);
  });

  it('co-sign, verifikasi, dan tinjau order hanya DPJP; residen menunggu co-sign tidak bisa memfinalkan', () => {
    const cosign = task({ action: { kind: 'cosign' } });
    expect(completionBlocker(cosign, 'dokter')).toBeNull();
    expect(completionBlocker(cosign, 'dokter_residen')).toMatch(/Hanya DPJP/);
    expect(completionBlocker(task({ action: { kind: 'verifikasi' } }), 'perawat')).toMatch(/Hanya DPJP/);
    const waiting = task({ action: { kind: 'buka' }, waitingFor: 'Menunggu co-sign DPJP.' });
    expect(completionBlocker(waiting, 'dokter_residen')).toBe('Menunggu co-sign DPJP.');
    expect(
      completionBlocker(task({ action: { kind: 'baca-ulang', value: '6,4', unit: 'mmol/L' } }), 'perawat'),
    ).toBeNull();
  });

  it('catatan penyelesaian dan ringkasan hitungan', () => {
    const kritis = task({
      id: 'k',
      priority: 'kritis',
      action: { kind: 'baca-ulang', value: '6,4', unit: 'mmol/L' },
    });
    expect(completionNote(kritis, 'Lapor ke DPJP dengan SBAR')).toBe(
      'Diterima dan dibaca ulang: 6,4 mmol/L · tindak lanjut: Lapor ke DPJP dengan SBAR',
    );
    const now = '2026-10-05T10:45:00+07:00';
    const list = [kritis, task({ id: 'a', dueAt: '2026-10-05T09:00:00+07:00' })];
    expect(worklistSummary(list, {}, now)).toEqual({ open: 2, critical: 1, overdue: 1, done: 0 });
    expect(worklistSummary(list, { k: { at: now, by: 'x', note: 'y' } }, now)).toEqual({
      open: 1,
      critical: 0,
      overdue: 1,
      done: 1,
    });
  });

  it('tautan tindak lanjut: rute berparameter atau ?pasien=', () => {
    expect(targetHref('/klinis/cppt', task({ encounterId: 'e1', target: { screen: 'cppt' } }))).toBe(
      '/klinis/cppt?pasien=e1',
    );
    expect(
      targetHref(
        '/klinis/rawat-inap',
        task({ target: { screen: 'ranap', suffix: '/e1', query: 'tab=cppt' } }),
      ),
    ).toBe('/klinis/rawat-inap/e1?tab=cppt');
  });
});

describe('fixture worklist hari demo', () => {
  const all = Object.values(WORKLIST_TASKS).flat();

  it('id tugas unik; pasien dan kunjungan cocok dengan fixture pasien; layar tindak lanjut terdaftar', () => {
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of all) {
      expect(patientById(t.patientId), t.id).toBeDefined();
      expect(encounterIdOf(t.patientId), t.id).toBe(t.encounterId);
      if (t.target) {
        expect(screenById(t.target.screen), `${t.id} → ${t.target.screen}`).toBeDefined();
      }
    }
    for (const list of Object.values(WORKLIST_PATIENTS)) {
      for (const p of list) expect(encounterIdOf(p.patientId)).toBe(p.encounterId);
    }
  });

  it('tautan CPOE hanya ke kunjungan yang punya halaman CPOE (bukan 404); pasien rawat inap ke rekam rawat inap', () => {
    // Tn. Hartono bergantung pada tahap skenario IGD; pasien lain tidak memakai hasil skenario.
    const noRun = {} as RunResult;
    for (const t of all.filter((x) => x.target?.screen === 'order')) {
      expect(t.encounterId).not.toBe(encounterIdOf(HARTONO_ID));
      expect(demoCpoeAvailable(t.encounterId, noRun), `${t.id} → /klinis/order`).toBe(true);
    }
  });

  it('setiap posisi klinis punya tugas; DPJP punya nilai kritis, co-sign, dan konsul lewat batas', () => {
    for (const list of Object.values(WORKLIST_TASKS)) expect(list.length).toBeGreaterThan(0);
    const kinds = WORKLIST_TASKS.dokter.map((t) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(['nilai-kritis', 'cosign', 'verifikasi', 'konsul']));
    expect(WORKLIST_TASKS.dokter.some((t) => isOverdue(t, DEMO_NOW))).toBe(true);
    expect(WORKLIST_TASKS.dokter_residen.some((t) => t.waitingFor)).toBe(true);
  });
});
