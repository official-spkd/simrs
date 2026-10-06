'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { demoCarePackages } from '@/lib/demo/fixtures/rme-paket';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { hasReason } from '@/lib/rme';
import { labFailures, markBlocker, startBlocker, todaySession } from '@/lib/rme-paket';
import { applyPaket } from '@/lib/rme-paket-toko';
import {
  committed,
  klinisSession,
  readRekam,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K15 · Server Action paket layanan khusus (mode presentasi, ADR-0023/0085): butir kelengkapan per profesi dari sesi,
 * gerbang lab pra-tindakan (tunda atau override beralasan oleh PPA klinis), mulai/selesai sesi hanya bila gerbang
 * lolos. Paket dibaca server (fixture + toko `rekam-medis`), keputusan tercatat atas nama pengguna sesi.
 */

const CLINICAL = ['dokter', 'dokter_residen', 'perawat', 'bidan'];
const revSchema = z.int().min(0);

async function paketOf(encounterId: string) {
  const pkg = demoCarePackages().find((p) => p.encounterId === encounterId);
  if (!pkg) return null;
  const { state } = await readRekam();
  return applyPaket(pkg, state.paket[encounterId], formatJam);
}

export async function markPaketItemAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('paket');
  if (!s) return REKAM_DENIED;
  const p = z
    .strictObject({ encounterId: z.string().min(1).max(60), itemId: z.string().min(1).max(120) })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Butir paket tidak valid.');
  const view = await paketOf(p.data.encounterId);
  const item = view?.pkg.items.find((x) => x.id === p.data.itemId);
  if (!view || !item) return rekamFail('Butir paket tidak ditemukan.');
  if (!todaySession(view.pkg.sessions)) return rekamFail('Tidak ada sesi berjalan hari ini.');
  const blocked = markBlocker(item, s.role?.code ?? null);
  if (blocked) return rekamFail(blocked);
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    { type: 'paket.butir', encounterId: p.data.encounterId, itemId: item.id, at },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: `${item.label} · selesai ${formatJam(at)}.` });
}

export async function paketGateAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('paket');
  if (!s) return REKAM_DENIED;
  if (!CLINICAL.includes(s.role?.code ?? ''))
    return rekamFail('Gerbang sesi diputuskan PPA klinis (dokter/perawat/bidan).');
  const p = z
    .strictObject({
      encounterId: z.string().min(1).max(60),
      decision: z.enum(['tunda', 'override']),
      reason: z.string().max(500),
    })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Keputusan gerbang tidak valid.');
  const view = await paketOf(p.data.encounterId);
  if (!view) return rekamFail('Paket tidak ditemukan.');
  const today = todaySession(view.pkg.sessions);
  if (!today || today.status !== 'hari-ini')
    return rekamFail('Tidak ada sesi hari ini yang menunggu gerbang.');
  const fails = labFailures(view.pkg.labGates);
  if (fails.length === 0) return rekamFail('Hasil lab di atas ambang; gerbang tidak perlu diputuskan.');
  if (p.data.decision === 'override' && !hasReason(p.data.reason)) {
    return rekamFail('Override gerbang lab wajib alasan klinis (minimal 10 karakter).');
  }
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'paket.gerbang',
      encounterId: p.data.encounterId,
      decision: p.data.decision,
      reason: p.data.decision === 'override' ? p.data.reason.trim() : null,
      note:
        p.data.decision === 'tunda'
          ? `Ditunda ${formatJam(at)} · ${fails[0]?.name ?? 'lab'} di bawah ambang`
          : `Override ${formatJam(at)}`,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message:
      p.data.decision === 'tunda'
        ? `Sesi ditunda · ${formatJam(at)}; DPJP menjadwalkan ulang.`
        : `Override gerbang lab tercatat · ${formatJam(at)}.`,
  });
}

export async function paketSessionAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('paket');
  if (!s) return REKAM_DENIED;
  if (!CLINICAL.includes(s.role?.code ?? ''))
    return rekamFail('Sesi dijalankan PPA klinis (dokter/perawat/bidan).');
  const p = z
    .strictObject({ encounterId: z.string().min(1).max(60), to: z.enum(['berlangsung', 'selesai']) })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Perubahan sesi tidak valid.');
  const view = await paketOf(p.data.encounterId);
  if (!view) return rekamFail('Paket tidak ditemukan.');
  const today = todaySession(view.pkg.sessions);
  if (!today) return rekamFail('Tidak ada sesi berjalan hari ini.');
  const oneStep = view.pkg.kind === 'anc';
  const starting = today.status === 'hari-ini';
  if (starting) {
    const blocked = startBlocker(view.pkg, view.decision);
    if (blocked) return rekamFail(blocked);
  } else if (p.data.to !== 'selesai') {
    return rekamFail('Sesi sudah berlangsung.');
  }
  const to = starting && !oneStep ? 'berlangsung' : 'selesai';
  if (to !== p.data.to) return rekamFail('Urutan sesi: mulai dulu, lalu selesaikan.');
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'paket.sesi',
      encounterId: p.data.encounterId,
      to,
      note: `${to === 'berlangsung' ? 'Mulai' : oneStep ? 'Ditutup' : 'Selesai'} ${formatJam(at)} · ${s.user.displayName}`,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message:
      to === 'berlangsung'
        ? `${view.pkg.title} dimulai · ${formatJam(at)}.`
        : `${oneStep ? view.pkg.finishLabel : `${view.pkg.cycleLabel} selesai`} · ${formatJam(at)}.`,
  });
}
