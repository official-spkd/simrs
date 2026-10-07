import 'server-only';
import type { CpptEntry, CpptNoteInput, CpptRole, InpatientDetail } from '@simrs/shared';
import { wib } from '../../../demo/fixtures/rawat-inap';
import { CPPT_VERIFIED } from '../../../demo/fixtures/rme-cppt';
import { PERSONA } from '../../../demo/fixtures/staf';
import { DEMO_TODAY } from '../../../demo/fixtures/waktu';
import { cpptAddendumBlocker, cpptRoleOf, supersededIds } from '../../../rawat-inap';
import { cosignBlocker, type CpptSign, verifyBlocker } from '../../../rme-cppt';
import { applyRekamInpatient, type RekamState, storedAuthorId } from '../../../rme-toko';
import { screenById, screenOpen } from '../../../screens';
import type { SessionView } from '../../../session-view';
import { commitEvent, readDomain } from '../../demo/state';
import { demoActionSession, encounterClock } from './shared';

/**
 * Bagian server domain toko `rekam-medis` (ADR-0085): baca keadaan (fixture + kejadian) dan terapkan ke rekam rawat
 * inap. Dipakai pengambil data Rawat inap dan bagan RME, serta Server Action yang memeriksa gerbang terhadap rekam
 * yang sama dengan yang tampil di layar. Hanya mode presentasi (`readDomain`/`commitEvent` memanggil `assertDemo`).
 */

/** Tanggal shift berjalan pasien non-skenario (hari presentasi). */
export const REKAM_DATE = DEMO_TODAY;

export async function readRekam(): Promise<{ state: RekamState; rev: number }> {
  return readDomain('rekam-medis');
}

/** Terapkan toko ke rekam rawat inap non-skenario (pasien skenario mengikuti mesin Simulasi). */
export function withRekam(d: InpatientDetail, state: RekamState): InpatientDetail {
  return d.summary.scenario ? d : applyRekamInpatient(d, state, REKAM_DATE);
}

/**
 * Dokter yang diperankan posisi aktif. Posisi dokter di mode presentasi membawakan DPJP persona demo; nama yang
 * tercatat pada atestasi tetap nama pengguna sesi (`ev.actor`).
 */
export function attestingDoctor(s: Pick<SessionView, 'role' | 'user'>): string {
  return s.role?.code === 'dokter' ? PERSONA.dokter : s.user.displayName;
}

/** Hasil Server Action yang menulis ke toko rekam medis. */
export interface RekamActionResult {
  ok: boolean;
  message: string;
  /** Tampilan basi: halaman dimuat ulang. */
  stale?: boolean;
  /** Isian yang galat. */
  field?: string;
  /** Revisi toko setelah aksi berhasil; aksi berikutnya memakainya tanpa menunggu halaman dimuat ulang. */
  rev?: number;
}

export const REKAM_DENIED: RekamActionResult = {
  ok: false,
  message: 'Posisi aktif Anda tidak memakai layar ini. Ganti posisi untuk melanjutkan.',
};

export const SCENARIO_RECORD =
  'Pasien simulasi: rekam medisnya mengikuti langkah skenario di Simulasi, bukan disimpan dari layar ini.';

/**
 * Sesi lengkap Server Action layar klinis `screenId` (pola `penunjangSession`): gerbang mode presentasi, sesi, dan
 * posisi aktif (termasuk "Bertindak sebagai") yang memakai layar itu. Null = posisi bukan pemakai layar.
 */
export async function klinisSession(screenId: string): Promise<SessionView | null> {
  const s = await demoActionSession();
  const screen = screenById(screenId);
  if (!screen || !screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null })) return null;
  return s;
}

export function rekamFail(message: string, field?: string): RekamActionResult {
  return { ok: false, message, field };
}

/** Hasil `commitEvent` sebagai hasil aksi (basi = muat ulang). */
export function committed<T extends object>(
  c: { ok: true; rev?: number } | { ok: false; error: string; stale?: true },
  ok: RekamActionResult & T,
): RekamActionResult & Partial<T> {
  if (c.ok) return c.rev === undefined ? ok : { ...ok, rev: c.rev };
  return { ok: false, message: c.error, stale: c.stale } as RekamActionResult & Partial<T>;
}

// ─── CPPT: tulis + atestasi (dipakai layar Rawat inap, CPPT, Worklist, Kelengkapan) ─────────────────────────

export interface CpptActionResult extends RekamActionResult {
  at?: string;
  version?: number;
  role?: CpptRole;
}

/**
 * Catat CPPT baru/koreksi/addendum atas `entries` (rekam yang tampil di layar, sudah termasuk toko). Koreksi hanya
 * oleh penulis: catatan tersimpan dibandingkan dengan id pengguna, catatan rekam awal dengan nama penulis.
 */
export async function commitCpptNote(
  s: SessionView,
  entries: readonly CpptEntry[],
  v: CpptNoteInput,
  rev: number,
): Promise<CpptActionResult> {
  const { state } = await readRekam();
  let version = 1;
  if (v.supersedesId !== null) {
    const target = entries.find((e) => e.id === v.supersedesId);
    if (!target) return rekamFail('Entri CPPT tidak ditemukan.');
    if (supersededIds(entries).has(target.id))
      return rekamFail('Entri ini sudah dikoreksi; koreksi versi terbaru.');
    const ownerId = storedAuthorId(state, target.id);
    const own = ownerId ? ownerId === s.user.id : target.author === s.user.displayName;
    if (!own) return rekamFail('Koreksi hanya oleh penulis catatan; PPA lain menambahkan addendum.');
    version = target.version + 1;
  } else if (v.addendumOf !== null) {
    const blocked = cpptAddendumBlocker(entries, v.addendumOf);
    if (blocked) return rekamFail(blocked);
  }
  const role = cpptRoleOf(s.role?.code);
  const at = wib(await encounterClock(s, v.encounterId));
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'cppt.ditulis',
      encounterId: v.encounterId,
      role,
      s: v.s,
      o: v.o,
      a: v.a,
      p: v.p,
      version,
      supersedesId: v.supersedesId,
      correctionReason: v.supersedesId ? v.correctionReason : null,
      addendumOf: v.addendumOf,
      writtenAt: at,
    },
    { rev, session: s },
  );
  return committed(c, { ok: true, message: 'CPPT tersimpan.', at, version, role });
}

/**
 * Co-sign (catatan residen) atau verifikasi DPJP (catatan PPA lain): posisi dokter yang membawakan DPJP pasien ini,
 * atas entri versi terbaru, bukan catatan sendiri (id pengguna). Tercatat atas nama pengguna sesi.
 */
export async function commitCpptSign(
  s: SessionView,
  rec: { encounterId: string; entries: readonly CpptEntry[]; dpjp: string },
  entryId: string,
  kind: 'cosign' | 'verifikasi',
  rev: number,
): Promise<RekamActionResult & { at?: string; by?: string }> {
  const entry = rec.entries.find((e) => e.id === entryId);
  if (!entry) return rekamFail('Entri CPPT tidak ditemukan.');
  const { state } = await readRekam();
  const who = {
    role: s.role?.code ?? null,
    user: s.user.displayName,
    actor: attestingDoctor(s),
    dpjp: rec.dpjp,
    superseded: supersededIds(rec.entries).has(entry.id),
  };
  const blocked =
    kind === 'cosign'
      ? storedAuthorId(state, entry.id) === s.user.id
        ? 'Tidak bisa co-sign catatan sendiri.'
        : cosignBlocker(entry, { ...who, cosigned: !!state.cosign[entry.id] })
      : verifyBlocker(entry, { ...who, verified: !!state.verify[entry.id] || !!CPPT_VERIFIED[entry.id] });
  if (blocked) return rekamFail(blocked);
  const at = wib(await encounterClock(s, rec.encounterId));
  const c = await commitEvent(
    'rekam-medis',
    kind === 'cosign'
      ? { type: 'cppt.cosign', encounterId: rec.encounterId, entryId: entry.id, at }
      : { type: 'cppt.verifikasi', encounterId: rec.encounterId, entryId: entry.id, at },
    { rev, session: s },
  );
  return committed(c, {
    ok: true,
    message: kind === 'cosign' ? 'Co-sign DPJP tersimpan.' : 'Verifikasi DPJP tersimpan.',
    at,
    by: s.user.displayName,
  });
}

/** Verifikasi DPJP berlaku per entri: rekam awal (fixture) + toko. */
export function verifiedOf(state: RekamState, ids: readonly string[]): Record<string, CpptSign> {
  return Object.fromEntries(
    ids.flatMap((id) => {
      const v = state.verify[id] ?? CPPT_VERIFIED[id];
      return v ? [[id, { by: v.by, at: v.at }]] : [];
    }),
  );
}
