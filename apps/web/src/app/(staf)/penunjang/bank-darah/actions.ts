'use server';

import { z } from 'zod';
import { demoBloodRequests, demoBloodUnits } from '@/lib/demo/fixtures/penunjang-bank-darah';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import {
  BLOOD_GATE_TEXT,
  compatible,
  ISSUE_CHECKS,
  isExpired,
  REACTION_SIGNS,
} from '@/lib/penunjang-bank-darah';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';

/**
 * S08 · Server Action bank darah (mode presentasi, ADR-0023). Klien mengirim id + isian; permintaan, pasien, dan
 * kantong dicari server dari fixture. Gerbang yang tidak bisa dilewati: kantong kedaluwarsa atau ABO/Rh-inkompatibel,
 * cek ganda dua petugas berbeda dengan semua butir, gelang dan kantong cocok di samping pasien (manual hanya dengan
 * alasan + petugas kedua). Tidak menyimpan apa pun.
 */

const id = z.string().min(1).max(40);
const name = z.string().max(120);
const abo = z.enum(['O', 'A', 'B', 'AB']);
const rh = z.enum(['+', '-']);
const vitals = z.strictObject({
  tempC: z.number().min(30).max(43),
  systolic: z.number().int().min(40).max(260),
  diastolic: z.number().int().min(20).max(160),
  pulse: z.number().int().min(20).max(250),
});

const input = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('terima'), requestId: id }),
  z.strictObject({ type: z.literal('golongan'), requestId: id, abo, rh }),
  z.strictObject({
    type: z.literal('crossmatch'),
    requestId: id,
    unitId: id,
    result: z.enum(['kompatibel', 'inkompatibel']),
    group: z.strictObject({ abo, rh }),
  }),
  z.strictObject({
    type: z.literal('keluarkan'),
    requestId: id,
    unitId: id,
    first: name,
    second: name,
    items: z.record(z.string().max(20), z.boolean()),
    group: z.strictObject({ abo, rh }),
  }),
  z.strictObject({
    type: z.literal('pasang'),
    requestId: id,
    wristband: z.string().max(40),
    bag: z.string().max(40),
    manual: z.strictObject({ reason: z.string().max(300), secondVerifier: name }).optional(),
    baseline: vitals,
  }),
  z.strictObject({
    type: z.literal('ttv'),
    requestId: id,
    label: z.string().max(40),
    vitals,
    signs: z.array(z.enum(REACTION_SIGNS)).max(REACTION_SIGNS.length),
  }),
  z.strictObject({ type: z.literal('selesai'), requestId: id }),
]);

export async function recordBloodAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('bank-darah');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Langkah bank darah tidak dikenal.');
  const a = p.data;
  const r = demoBloodRequests().find((x) => x.id === a.requestId);
  if (!r) return invalid('Permintaan darah tidak ditemukan.');
  const unitOf = (unitId: string) => demoBloodUnits().find((u) => u.id === unitId);
  switch (a.type) {
    case 'terima':
      return simulated(`Permintaan darah ${r.patient.name} diterima`);
    case 'golongan':
      return simulated(`Golongan darah ${r.patient.name} dicatat ${a.abo} Rh${a.rh}`);
    case 'crossmatch':
    case 'keluarkan': {
      const u = unitOf(a.unitId);
      // Golongan dari fixture menang; kiriman klien hanya dipakai untuk pasien yang digolongkan di sesi ini.
      const group = r.abo && r.rh ? { abo: r.abo, rh: r.rh } : a.group;
      if (!u || u.component !== r.component) return invalid(BLOOD_GATE_TEXT.COMPONENT_MISMATCH);
      if (isExpired(u, DEMO_TODAY)) return invalid(BLOOD_GATE_TEXT.BAG_EXPIRED);
      if (!compatible(group, u)) return invalid(BLOOD_GATE_TEXT.ABO_INCOMPATIBLE);
      if (a.type === 'crossmatch') return simulated(`Crossmatch ${u.bagNo} ${a.result}`);
      const [x, y] = [a.first.trim(), a.second.trim()];
      if (x.length < 5 || y.length < 5) return invalid(BLOOD_GATE_TEXT.CHECKER_REQUIRED);
      if (x.toLowerCase() === y.toLowerCase()) return invalid(BLOOD_GATE_TEXT.CHECKER_SAME);
      if (!ISSUE_CHECKS.every((c) => a.items[c.id])) return invalid(BLOOD_GATE_TEXT.CHECKLIST_INCOMPLETE);
      return simulated(`Kantong ${u.bagNo} dikeluarkan dengan cek ganda`);
    }
    case 'pasang': {
      if (a.manual) {
        if (a.manual.reason.trim().length < 10 || a.manual.secondVerifier.trim().length < 5)
          return invalid(BLOOD_GATE_TEXT.MANUAL_REASON);
        return simulated('Transfusi dimulai dengan verifikasi manual dua petugas');
      }
      const norm = (v: string) => v.replace(/\s+/g, '').toUpperCase();
      if (norm(a.wristband) !== norm(r.patient.rm)) return invalid(BLOOD_GATE_TEXT.WRONG_PATIENT);
      const u = demoBloodUnits().find((x) => norm(x.bagNo) === norm(a.bag));
      if (!u || u.component !== r.component) return invalid(BLOOD_GATE_TEXT.WRONG_BAG);
      return simulated(`Gelang dan kantong ${u.bagNo} cocok, transfusi dimulai`);
    }
    case 'ttv':
      return simulated(a.signs.length ? 'Reaksi transfusi dilaporkan' : `TTV ${a.label} dicatat`);
    case 'selesai':
      return simulated('Transfusi selesai');
  }
}
