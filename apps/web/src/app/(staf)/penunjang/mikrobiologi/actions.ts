'use server';

import { z } from 'zod';
import { DOKTER_PA, demoCultures, demoPaCases } from '@/lib/demo/fixtures/penunjang-mikro';
import { STAF } from '@/lib/demo/fixtures/staf';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { AST_PANELS, GRAM_RESULTS, MICRO_GATE_TEXT, ORGANISMS } from '@/lib/penunjang-mikro';

/**
 * S02 · Server Action mikrobiologi dan PA (mode presentasi, ADR-0023). Kasus dicari server dari fixture; kosakata
 * (Gram, organisme lokal, panel S/I/R) dan kelengkapan isian sebelum TTE ditegakkan server. Tidak menyimpan apa pun.
 */

const id = z.string().min(1).max(40);
const gram = z.enum(GRAM_RESULTS);
const text = z.string().max(2000);

const input = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pertumbuhan'), caseId: id, grew: z.boolean() }),
  z.strictObject({ kind: z.literal('gram'), caseId: id, result: gram }),
  z.strictObject({ kind: z.literal('identifikasi'), caseId: id, gram, organism: z.string().max(80) }),
  z.strictObject({
    kind: z.literal('kepekaan'),
    caseId: id,
    gram,
    results: z.record(z.string().max(40), z.enum(['S', 'I', 'R'])),
  }),
  z.strictObject({ kind: z.literal('final'), caseId: id }),
  z.strictObject({ kind: z.literal('pa-tte'), caseId: id, macro: text, micro: text, diagnosis: text }),
  z.strictObject({ kind: z.literal('pa-addendum'), caseId: id, text }),
]);

export async function recordMicroAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('mikro');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Langkah mikrobiologi/PA tidak dikenal.');
  const a = p.data;
  if (a.kind === 'pa-tte' || a.kind === 'pa-addendum') {
    const pa = demoPaCases().find((x) => x.id === a.caseId);
    if (!pa) return invalid('Kasus PA tidak ditemukan.');
    if (a.kind === 'pa-tte') {
      if ([a.macro, a.micro, a.diagnosis].some((t) => t.trim().length < 10))
        return invalid(MICRO_GATE_TEXT.TEXT_REQUIRED);
      return simulated(`Laporan ${pa.paNo} ditandatangani (TTE ${DOKTER_PA}) dan dikunci`);
    }
    if (a.text.trim().length < 10) return invalid(MICRO_GATE_TEXT.TEXT_REQUIRED);
    return simulated(`Addendum ${pa.paNo} ditambahkan; laporan asli tidak berubah`);
  }
  const c = demoCultures().find((x) => x.id === a.caseId);
  if (!c) return invalid('Kultur tidak ditemukan.');
  switch (a.kind) {
    case 'pertumbuhan':
      return simulated(`${c.specimen} ${c.labNo}: ${a.grew ? 'tumbuh' : 'tidak tumbuh'}`);
    case 'gram':
      return simulated(
        `Pewarnaan Gram ${c.labNo}: ${a.result}${c.blood ? ' · kultur darah positif = nilai kritis' : ''}`,
      );
    case 'identifikasi':
      if (!ORGANISMS[a.gram].includes(a.organism)) return invalid(MICRO_GATE_TEXT.ORGANISM_MISMATCH);
      return simulated(`Identifikasi ${c.labNo}: ${a.organism}`);
    case 'kepekaan':
      if (!AST_PANELS[a.gram].every((ab) => a.results[ab])) return invalid(MICRO_GATE_TEXT.AST_INCOMPLETE);
      return simulated(`Uji kepekaan ${c.labNo} tersimpan`);
    case 'final':
      return simulated(`Laporan akhir ${c.labNo} divalidasi (TTE ${STAF.dokterPatologiKlinik})`);
  }
}
