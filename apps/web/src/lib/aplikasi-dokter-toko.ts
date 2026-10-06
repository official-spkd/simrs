import { z } from 'zod';
import { idSchema, jamSchema, must, roleBlock } from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { COSIGN_NOTES } from './demo/fixtures/manajemen';

/**
 * I08 · Domain toko demo `aplikasi-dokter` (ADR-0085, CX-3): co-sign CPPT residen dari ponsel DPJP (setujui TTE
 * atas nama pengguna sesi, atau beri catatan). Hanya posisi Dokter (DPJP), bukan residen penulisnya.
 * Read-back nilai kritis dari aplikasi TIDAK di sini: dicatat ke domain `hasil-kritis` (Server Action aplikasi
 * dokter) agar Pusat hasil kritis dan Laboratorium melihat laporan yang sama.
 *
 * Kejadian `cosign.ditandatangani` {noteId, patientName, rm} bisa dilanggan CPPT/Kelengkapan (CD-2).
 */

export const DOCTOR_APP_DOMAIN = 'aplikasi-dokter';
export const COSIGN_ROLES = ['dokter'] as const;

export const doctorAppEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('cosign.ditandatangani'),
    noteId: idSchema,
    patientName: z.string().min(1).max(120),
    rm: z.string().min(1).max(20),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('cosign.dicatat'),
    noteId: idSchema,
    note: z.string().trim().min(5).max(400),
    jam: jamSchema,
  }),
]);
export type DoctorAppEvent = z.infer<typeof doctorAppEventSchema>;

export interface DoctorAppStoreState {
  signed: Record<string, { jam: string; by: string }>;
  notes: Record<string, { note: string; jam: string; by: string }>;
}

function gate(s: DoctorAppStoreState, ev: DoctorAppEvent, actor: DemoActor): string | null {
  const n = COSIGN_NOTES.find((x) => x.id === ev.noteId);
  if (!n) return 'CPPT residen tidak ditemukan.';
  if (s.signed[ev.noteId]) return 'CPPT ini sudah ditandatangani.';
  const role = roleBlock(actor, COSIGN_ROLES, 'Co-sign CPPT residen oleh posisi Dokter (DPJP).');
  if (role) return role;
  if (ev.type === 'cosign.ditandatangani' && (ev.patientName !== n.patientName || ev.rm !== n.rm))
    return 'Data CPPT tidak sesuai.';
  return null;
}

export const doctorAppDomain = defineDomain<DoctorAppStoreState, DoctorAppEvent>(DOCTOR_APP_DOMAIN, {
  initial: () => ({ signed: {}, notes: {} }),
  eventSchema: doctorAppEventSchema,
  screens: ['app-dokter'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    if (d.type === 'cosign.ditandatangani')
      return { ...s, signed: { ...s.signed, [d.noteId]: { jam: d.jam, by: ev.actor.name } } };
    return {
      ...s,
      notes: { ...s.notes, [d.noteId]: { note: d.note.trim(), jam: d.jam, by: ev.actor.name } },
    };
  },
});
