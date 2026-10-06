'use server';

import { bedAllocationInputSchema, formatJam } from '@simrs/shared';
import { z } from 'zod';
import { ENCOUNTER_ID } from '@/lib/demo/fixtures/ids';
import { RESUME_ENCOUNTERS, SCENARIO_BEDS, wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { BED_NEXT } from '@/lib/rawat-inap-bed-toko';
import { BED_STATUS_META } from '@/lib/rawat-inap';
import { getBedBoard } from '@/lib/server/data/klinis/bed';
import { getEdBoard } from '@/lib/server/data/klinis/igd';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * K05 · Server Action papan tempat tidur (mode presentasi, ADR-0023): gerbang demo + sesi + posisi pemakai layar,
 * kontrak zod, lalu aturan dibaca dari papan server (fixture + toko demo `tempat-tidur`, ADR-0085): alokasi hanya ke
 * bed Siap yang bukan bed naskah skenario; transisi status hanya urutan yang sah; pasien rawat inap yang resumenya
 * disiapkan baru bisa dipulangkan setelah resume final (TTE DPJP). Tersimpan atas nama pengguna sesi.
 */

const revSchema = z.int().min(0);
const SCENARIO_ENCOUNTERS: readonly string[] = [ENCOUNTER_ID.hartono, ENCOUNTER_ID.ratna];

export async function allocateBedAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('bed');
  if (!s) return REKAM_DENIED;
  const parsed = bedAllocationInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) return rekamFail('Permintaan alokasi tidak valid.');
  const board = await getBedBoard(s);
  const req = board.requests.find((x) => x.id === parsed.data.requestId);
  if (!req) return rekamFail('Permintaan bed tidak ditemukan atau sudah dialokasikan.');
  if (req.scenario) return rekamFail('Permintaan pasien simulasi dialokasikan lewat tugas skenario.');
  const bed = board.beds.find((b) => b.code === parsed.data.bedCode);
  if (!bed || bed.status !== 'siap') {
    return rekamFail('Pilih dulu bed berstatus Siap di peta, lalu tekan Alokasikan pada permintaan.');
  }
  if (SCENARIO_BEDS.includes(bed.code)) {
    return rekamFail(`${bed.code} disiapkan untuk pasien simulasi; pilih bed Siap lain.`);
  }
  const { state } = await readDomain('tempat-tidur');
  const fromIgd = state.igdRequests.find((x) => x.id === req.id);
  const encounterId =
    fromIgd?.encounterId ??
    (req.rm ? ((await getEdBoard(s)).items.find((p) => p.rm === req.rm)?.encounterId ?? null) : null);
  const now = demoNow();
  const c = await commitEvent(
    'tempat-tidur',
    {
      type: 'bed.dialokasikan',
      requestId: req.id,
      bedCode: bed.code,
      wardCode: bed.wardCode,
      patientLabel: req.patientName,
      encounterId,
      from: req.from,
      at: wib(now),
    },
    { rev: r.data, session: s },
  );
  const short = req.patientName.split(' ').slice(0, 2).join(' ');
  return committed(c, {
    ok: true,
    message: `${short} dialokasikan ke ${bed.code} · dipesan ${formatJam(now)} · notifikasi ke ${req.from}`,
    at: formatJam(now),
  });
}

const statusInput = z.strictObject({ bedCode: z.string().min(1).max(12) });

/** Status bed berikutnya (pasien tiba, pulang, kebersihan, perbaikan). */
export async function advanceBedAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('bed');
  if (!s) return REKAM_DENIED;
  const parsed = statusInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) return rekamFail('Bed tidak dikenal.');
  const board = await getBedBoard(s);
  const bed = board.beds.find((b) => b.code === parsed.data.bedCode);
  if (!bed) return rekamFail('Bed tidak dikenal.');
  if (bed.encounterId && SCENARIO_ENCOUNTERS.includes(bed.encounterId)) {
    return rekamFail('Status bed pasien simulasi mengikuti alur admisi di Simulasi.');
  }
  const next = BED_NEXT[bed.status];
  if (!next)
    return rekamFail(
      `Bed ${BED_STATUS_META[bed.status].label.toLowerCase()} tidak punya langkah berikutnya.`,
    );
  if (bed.status === 'pulang' && bed.encounterId && RESUME_ENCOUNTERS.includes(bed.encounterId)) {
    const resume = await readDomain('resume-medis');
    if (!resume.state.final[bed.encounterId]) {
      return rekamFail('Resume medis pasien belum final (TTE DPJP); pasien belum bisa dipulangkan.');
    }
  }
  const now = demoNow();
  const t = formatJam(now);
  const c = await commitEvent(
    'tempat-tidur',
    {
      type: 'bed.status',
      bedCode: bed.code,
      from: bed.status,
      to: next.to,
      note: next.note(t),
      clear: !!next.clear,
      encounterId: bed.encounterId,
      at: wib(now),
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `${bed.code} · ${BED_STATUS_META[next.to].label.toLowerCase()} ${t}`,
  });
}
