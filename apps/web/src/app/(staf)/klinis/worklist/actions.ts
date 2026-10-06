'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { WORKLIST_TASKS } from '@/lib/demo/fixtures/rme-worklist';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  completionBlocker,
  completionNote,
  readBackMatches,
  WORKLIST_FOLLOW_UPS,
  worklistRole,
} from '@/lib/rme-worklist';
import {
  commitCpptSign,
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K01 · Penyelesaian tugas worklist (mode presentasi, ADR-0023/0085). Tugas dicari server dari worklist posisi sesi
 * (klien hanya mengirim id); gerbang per jenis: baca ulang nilai kritis harus cocok + tindak lanjut, co-sign dan
 * verifikasi hanya DPJP pasien (dicatat sebagai co-sign/verifikasi CPPT yang sama dengan layar CPPT, Rawat inap, dan
 * Kelengkapan), tinjau order hanya DPJP. Tersimpan atas nama pengguna sesi.
 */

const input = z.strictObject({
  taskId: z.string().min(1).max(120),
  readBack: z.string().max(40).nullable(),
  followUp: z.string().max(80).nullable(),
});

export async function completeWorklistTaskAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('worklist');
  if (!s) return REKAM_DENIED;
  const role = worklistRole(s.role?.code);
  const p = input.safeParse(raw);
  const r = z.int().min(0).safeParse(rev);
  if (!role || !p.success || !r.success) return rekamFail('Tugas worklist tidak dikenal.');
  const task = WORKLIST_TASKS[role].find((t) => t.id === p.data.taskId);
  if (!task) return rekamFail('Tugas ini bukan milik worklist posisi Anda.');
  const blocked = completionBlocker(task, role);
  if (blocked) return rekamFail(blocked);
  const a = task.action;

  if ((a.kind === 'cosign' || a.kind === 'verifikasi') && task.ref?.kind === 'cppt') {
    const view = await rmeChartById(task.encounterId);
    if (!view?.chart.inpatient) return rekamFail('Rekam CPPT pasien tidak ditemukan.');
    const res = await commitCpptSign(
      s,
      { encounterId: task.encounterId, entries: view.chart.inpatient.cppt, dpjp: view.chart.dpjp },
      task.ref.entryId,
      a.kind === 'cosign' ? 'cosign' : 'verifikasi',
      r.data,
    );
    return res.ok && res.at
      ? { ok: true, message: `${completionNote(task)} · ${formatJam(res.at)}`, at: res.at }
      : res;
  }

  let followUp: string | undefined;
  if (a.kind === 'baca-ulang') {
    if (!readBackMatches(p.data.readBack ?? '', a.value)) {
      return rekamFail('Nilai tidak cocok dengan laporan lab. Konfirmasi ulang ke pelapor sebelum menerima.');
    }
    const f = p.data.followUp ?? '';
    if (!WORKLIST_FOLLOW_UPS.includes(f)) return rekamFail('Pilih tindak lanjut.');
    followUp = f;
  } else if (a.kind === 'buka') {
    return rekamFail('Diselesaikan di layar tindak lanjut.');
  }
  const at = wib(demoNow());
  const note = completionNote(task, followUp);
  const c = await commitEvent(
    'rekam-medis',
    { type: 'worklist.selesai', encounterId: task.encounterId, taskId: task.id, note, at },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: `${note} · ${formatJam(at)}`, at });
}
