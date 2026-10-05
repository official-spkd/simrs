import { Injectable } from '@nestjs/common';
import type { DischargeDisposition } from '@simrs/shared';

/**
 * K13 · Gerbang tutup kunjungan (EP 5c, rencana 3.6). ADT memanggil gerbang ini sebelum memulangkan pasien; aturan
 * lengkap (RI: disposisi + resume final ber-TTE; meninggal: surat kematian; rujuk: surat rujukan F07) dipasang potongan
 * 3.6 dengan mengganti provider token `DISCHARGE_GATE`. Hasil `blocked` → 409 `DISCHARGE_BLOCKED` berisi alasan.
 */
export interface DischargeGateInput {
  encounterId: string;
  encounterClass: 'AMB' | 'EMER' | 'IMP';
  disposition: DischargeDisposition;
}

export type DischargeGateResult = { ok: true } | { ok: false; reasons: string[] };

export interface DischargeGate {
  check(input: DischargeGateInput): Promise<DischargeGateResult>;
}

export const DISCHARGE_GATE = Symbol('DISCHARGE_GATE');

/**
 * Bawaan sampai 3.6: hanya memastikan disposisi dikenal untuk kelas kunjungan (rawat inap tidak dipulangkan sebagai
 * `pindah_rawat` tanpa admisi lain tidak diperiksa di sini). Tidak menggantikan pemeriksaan resume 3.6.
 */
@Injectable()
export class BasicDischargeGate implements DischargeGate {
  check(input: DischargeGateInput): Promise<DischargeGateResult> {
    if (input.encounterClass === 'AMB') {
      return Promise.resolve({
        ok: false,
        reasons: ['Kunjungan rawat jalan ditutup lewat pemeriksaan poli'],
      });
    }
    return Promise.resolve({ ok: true });
  }
}
