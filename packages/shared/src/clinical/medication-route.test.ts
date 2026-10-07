import { describe, expect, it } from 'vitest';
import { defaultMedicationRoute, dosageFormGroup, medicationRouteConflict } from './medication-route';

describe('rute obat terhadap bentuk sediaan (K09)', () => {
  it('kelompok sediaan dari master obat', () => {
    expect(dosageFormGroup('tablet')).toBe('oral');
    expect(dosageFormGroup('tablet kunyah')).toBe('oral');
    expect(dosageFormGroup('kapsul')).toBe('oral');
    expect(dosageFormGroup('Sirup')).toBe('oral');
    expect(dosageFormGroup('injeksi')).toBe('parenteral');
    expect(dosageFormGroup('infus')).toBe('parenteral');
    expect(dosageFormGroup('salep')).toBe('lainnya');
    expect(dosageFormGroup(null)).toBe('lainnya');
  });

  it('rute bawaan hanya untuk sediaan oral; injeksi dan lainnya kosong (dokter wajib memilih)', () => {
    expect(defaultMedicationRoute('kapsul')).toBe('oral');
    expect(defaultMedicationRoute('injeksi')).toBe('');
    expect(defaultMedicationRoute('infus')).toBe('');
    expect(defaultMedicationRoute('inhaler')).toBe('');
    expect(defaultMedicationRoute(null)).toBe('');
  });

  it('injeksi lewat oral bertentangan; lewat IV/IM/SC (termasuk singkatan) tidak', () => {
    expect(medicationRouteConflict('injeksi', 'oral')).toBe(true);
    expect(medicationRouteConflict('injeksi', 'sublingual')).toBe(true);
    for (const route of ['intravena', 'intramuskular', 'subkutan', 'IV', 'SC', 'im']) {
      expect(medicationRouteConflict('injeksi', route), route).toBe(false);
    }
  });

  it('tablet lewat intravena bertentangan; sublingual/oral tidak; bentuk lain tidak dinilai', () => {
    expect(medicationRouteConflict('tablet', 'intravena')).toBe(true);
    expect(medicationRouteConflict('tablet', 'IV')).toBe(true);
    expect(medicationRouteConflict('tablet', 'oral')).toBe(false);
    expect(medicationRouteConflict('tablet', 'sublingual')).toBe(false);
    expect(medicationRouteConflict('salep', 'topikal')).toBe(false);
    expect(medicationRouteConflict(null, 'oral')).toBe(false);
  });
});
