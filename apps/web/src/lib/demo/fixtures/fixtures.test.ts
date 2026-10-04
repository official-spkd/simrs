import { PRESENTATION_PERSONAS } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../skenario';
import { demoExecutiveDashboard } from './dasbor';
import { PASIEN, patientByScenario } from './pasien';
import { BANGSAL, POLI, queueNo, UNIT } from './rs';
import { DOKTER, PERSONA } from './staf';

describe('fixture bersama mode presentasi', () => {
  it('nama persona sama dengan akun presentasi yang login', () => {
    const names = new Set(PRESENTATION_PERSONAS.map((p) => p.displayName));
    for (const n of Object.values(PERSONA)) expect(names, n).toContain(n);
  });

  it('kapasitas bangsal sama dengan Dasbor direksi (rawat inap kelas, ICU, isolasi)', () => {
    const cap = demoExecutiveDashboard('hari-ini').capacity;
    const kelas = BANGSAL.filter((b) => b.kelas.startsWith('Kelas') || b.kelas === 'VIP');
    const sum = (k: 'beds' | 'occupied', list: typeof BANGSAL) => list.reduce((a, b) => a + b[k], 0);
    expect(cap.find((c) => c.id === 'ranap-kelas')).toMatchObject({
      used: sum('occupied', kelas),
      total: sum('beds', kelas),
    });
    const icu = BANGSAL.find((b) => b.code === 'ICU');
    expect(cap.find((c) => c.id === 'icu')).toMatchObject({ used: icu?.occupied, total: icu?.beds });
    const iso = BANGSAL.find((b) => b.code === 'ISOLASI');
    expect(cap.find((c) => c.id === 'isolasi')).toMatchObject({ used: iso?.occupied, total: iso?.beds });
  });

  it('unit seed dan poli konsisten; nomor antrean berformat docs/04', () => {
    for (const p of POLI) if (p.unitCode) expect(Object.keys(UNIT)).toContain(p.unitCode);
    expect(new Set(POLI.map((p) => p.code)).size).toBe(POLI.length);
    expect(queueNo('PD', 27)).toBe('PD-027');
    for (const d of DOKTER) if (d.poli) expect(POLI.map((p) => p.code)).toContain(d.poli);
    expect(new Set(DOKTER.map((d) => d.id)).size).toBe(DOKTER.length);
  });

  it('pasien: RM unik, identitas jelas fiktif (NIK 9999, BPJS 0000, HP 0812-0000)', () => {
    expect(new Set(PASIEN.map((p) => p.rm)).size).toBe(PASIEN.length);
    expect(new Set(PASIEN.map((p) => p.id)).size).toBe(PASIEN.length);
    for (const p of PASIEN) {
      expect(p.rm).toMatch(/^00-\d{2}-\d{2}-\d{2}$/);
      expect(p.nikMasked).toMatch(/^9999•{8}\d{4}$/);
      if (p.bpjsMasked) expect(p.bpjsMasked).toMatch(/^0000\d{3}•{3}\d{3}$/);
      expect(p.telepon).toMatch(/^0812-0000-\d{4}$/);
      expect(p.penjamin === 'BPJS').toBe(p.bpjsMasked !== null);
    }
  });

  it('pasien skenario sama dengan rekam medis awal di naskah Simulasi', () => {
    for (const def of Object.values(SCENARIOS)) {
      const p = patientByScenario(def.id);
      expect(p, def.id).toBeDefined();
      expect(p).toMatchObject({ nama: def.base.nama, rm: def.base.rm, umur: def.base.umur, jk: def.base.jk });
      expect(p?.riwayat).toBe(def.base.riwayat);
    }
  });
});
