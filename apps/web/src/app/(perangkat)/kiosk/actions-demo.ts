'use server';

import { wallClockSchema } from '@simrs/shared';
import { z } from 'zod';
import { DEFAULT_PATIENT_ID } from '@/lib/demo/fixtures/front-office';
import { TICKET_PURPOSES } from '@/lib/front-office-antrean';
import { frontOfficeActionSession } from '@/lib/server/data/front-office/shared';
import { commitFresh, nextKioskTicket } from '@/lib/server/data/front-office/toko';

/**
 * F05 · Server Action anjungan MODE PRESENTASI (ADR-0023/0085). Endpoint POST publik: gerbang demo + sesi lengkap +
 * posisi yang memakai layar Anjungan. Nomor tiket dihitung server dari antrean terkini (tidak dikirim klien), lalu
 * tersimpan di toko demo bersama (domain `antrean`) sehingga muncul di meja pendaftaran dan papan TV. Jalur api
 * anjungan ada di `actions.ts` (perangkat terdaftar) dan tidak tersentuh.
 */

export interface KioskDemoResult {
  ok: boolean;
  message: string;
  ticketNo?: string;
  stale?: boolean;
}

const DENIED: KioskDemoResult = { ok: false, message: 'Posisi Anda tidak memakai layar Anjungan.' };

/**
 * Cetak tiket anjungan untuk pasien lokal (Ny. Siti Rahmawati, identitas dari kode booking/NIK/BPJS di keypad):
 * tujuan 0–2 = loket pendaftaran, 3 = farmasi rawat jalan. Satu tiket per layanan per pasien; pasien yang sudah
 * terdaftar hari ini tidak mengambil tiket loket lagi.
 */
export async function takeKioskTicketAction(input: unknown): Promise<KioskDemoResult> {
  const s = await frontOfficeActionSession('kiosk');
  if (!s) return DENIED;
  const p = z
    .strictObject({
      purpose: z
        .number()
        .int()
        .min(0)
        .max(TICKET_PURPOSES.length - 1),
      jam: wallClockSchema,
    })
    .safeParse(input);
  if (!p.success) return { ok: false, message: 'Pilihan antrean tidak dikenali. Ulangi dari awal.' };
  const purpose = TICKET_PURPOSES[p.data.purpose] ?? 'booking';
  const service: 'loket' | 'farmasi' = purpose === 'farmasi' ? 'farmasi' : 'loket';
  const r = await commitFresh(s, 'antrean', (fo) => ({
    type: 'tiket.diambil' as const,
    ticketNo: nextKioskTicket(fo, service),
    service,
    purpose,
    patientId: DEFAULT_PATIENT_ID,
    jam: p.data.jam,
  }));
  if (!r.ok) return { ok: false, message: r.error };
  const no = r.event.type === 'tiket.diambil' ? r.event.ticketNo : '';
  return { ok: true, ticketNo: no, message: `Tiket ${no} tercetak · ${p.data.jam}` };
}

/** "Panggil petugas": permintaan bantuan tampil di meja pendaftaran sampai ditangani (tanpa data pasien). */
export async function requestKioskAssistAction(input: unknown): Promise<KioskDemoResult> {
  const s = await frontOfficeActionSession('kiosk');
  if (!s) return DENIED;
  const p = z.strictObject({ jam: wallClockSchema }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Permintaan tidak dikenali.' };
  const r = await commitFresh(s, 'antrean', () => ({
    type: 'bantuan.diminta' as const,
    device: 'Anjungan 1 · lobi',
    jam: p.data.jam,
  }));
  if (!r.ok) return { ok: false, message: r.error };
  return { ok: true, message: `Petugas dipanggil pukul ${p.data.jam}` };
}
