import type { ScenarioRecord } from '../engine/types';

/** Rekam medis awal kosong; skenario mengisi identitas pasien fiktifnya sendiri. */
export function emptyRecord(
  patient: Pick<ScenarioRecord, 'nama' | 'initials' | 'jk' | 'umur' | 'rm' | 'alergi' | 'riwayat'> &
    Pick<ScenarioRecord, 'penjamin' | 'lokasi'>,
): ScenarioRecord {
  return {
    ...patient,
    sep: '',
    antrean: '',
    ttv: '',
    triase: '',
    dx: [],
    order: [],
    hasil: [],
    obat: [],
    tindakan: [],
    kontrol: '',
    klaim: '',
    bayarPasien: null,
    pulangAt: null,
    bayar: [],
    biaya: [],
    deposit: 0n,
    dibiayai: 0n,
    piutangBiaya: 0n,
    lunasQris: 0n,
    selisih: 0n,
  };
}
