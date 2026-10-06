import { describe, expect, it } from 'vitest';
import { encounterIdOf } from './demo/fixtures/pasien';
import { demoCarePackages } from './demo/fixtures/rme-paket';
import {
  type CarePackage,
  labFailures,
  markBlocker,
  missingItems,
  setTodayStatus,
  startBlocker,
  todaySession,
} from './rme-paket';

const pkg = (kind: CarePackage['kind']): CarePackage => {
  const p = demoCarePackages().find((x) => x.kind === kind);
  if (!p) throw new Error(kind);
  return p;
};

describe('paket layanan khusus (K15)', () => {
  it('fixture: tiap paket punya tepat satu sesi hari ini dan kunjungan cocok', () => {
    for (const p of demoCarePackages()) {
      expect(encounterIdOf(p.patientId)).toBe(p.encounterId);
      expect(p.sessions.filter((s) => s.status === 'hari-ini')).toHaveLength(1);
    }
  });

  it('kemoterapi: Hb 8,9 di bawah ambang; mulai tertahan sampai kelengkapan + keputusan gerbang', () => {
    const k = pkg('kemoterapi');
    expect(labFailures(k.labGates).map((g) => g.name)).toEqual(['Hemoglobin']);
    expect(startBlocker(k, null)).toMatch(/^Lengkapi dulu: Verifikasi ganda dosis/);
    const lengkap = k.items.map((i) => ({
      ...i,
      done: i.done ?? { by: 'x', at: '2026-10-05T10:50:00+07:00' },
    }));
    expect(startBlocker({ ...k, items: lengkap }, null)).toMatch(/di bawah ambang/);
    expect(
      startBlocker(
        { ...k, items: lengkap },
        { kind: 'override', reason: 'Transfusi PRC selesai, Hb ulang 10,2', by: 'dr', at: 'x' },
      ),
    ).toBeNull();
    expect(
      startBlocker({ ...k, items: lengkap }, { kind: 'override', reason: 'singkat', by: 'dr', at: 'x' }),
    ).not.toBeNull();
  });

  it('hemodialisis: butir DPJP hanya untuk posisi dokter; tanpa gerbang lab setelah lengkap', () => {
    const hd = pkg('hemodialisis');
    const resep = hd.items.find((i) => i.id === 'hd-resep');
    if (!resep) throw new Error('resep');
    expect(markBlocker(resep, 'perawat')).toBe('Diisi oleh Dokter (DPJP).');
    expect(markBlocker(resep, 'dokter')).toBeNull();
    expect(missingItems(hd.items).map((i) => i.id)).toEqual(['hd-akses', 'hd-resep']);
    const lengkap = hd.items.map((i) => ({ ...i, done: { by: 'x', at: 'y' } }));
    expect(startBlocker({ ...hd, items: lengkap }, null)).toBeNull();
  });

  it('status sesi hari ini: mulai → selesai / ditunda tanpa mengubah sesi lain', () => {
    const s = pkg('hemodialisis').sessions;
    const run = setTodayStatus(s, 'berlangsung', 'Mulai 11.00');
    expect(todaySession(run)?.status).toBe('berlangsung');
    const fin = setTodayStatus(run, 'selesai', 'Selesai 15.00');
    expect(todaySession(fin)).toBeUndefined();
    expect(fin.filter((x) => x.status === 'terjadwal')).toHaveLength(1);
  });
});
