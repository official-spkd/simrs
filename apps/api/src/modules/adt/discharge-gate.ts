import type { DischargeDisposition } from '@simrs/shared';

/**
 * K13 · Gerbang tutup kunjungan (EP 5c, rencana 3.6). ADT dan tutup kunjungan rawat jalan memanggil gerbang ini sebelum
 * menyelesaikan kunjungan. Implementasi penuh: `FullDischargeGate` (modul discharge, potongan 3.6). Hasil `blocked` →
 * 409 `DISCHARGE_BLOCKED` berisi alasan; `forbidden` → 403 (pelaku tidak berwenang untuk disposisi itu, mis. admisi
 * untuk disposisi meninggal, keputusan K-1).
 */
export interface DischargeGateInput {
  encounterId: string;
  encounterClass: 'AMB' | 'EMER' | 'IMP';
  disposition: DischargeDisposition;
}

export type DischargeGateResult = { ok: true } | { ok: false; reasons: string[]; forbidden?: boolean };

export interface DischargeGate {
  check(input: DischargeGateInput): Promise<DischargeGateResult>;
}

export const DISCHARGE_GATE = Symbol('DISCHARGE_GATE');
