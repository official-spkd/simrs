'use server';

import { formatJam, triageAssessmentSchema, WARD_CLASSES } from '@simrs/shared';
import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { certificateNo, DEAD_NO_ADMISSION, DEATH_CAUSES, igdBedRequestId } from '@/lib/klinis-igd-toko';
import {
  canTriage,
  TRIAGE_ROLE_REASON,
  triageBlocker,
  triageNeedsReason,
  walkInEncounterId,
} from '@/lib/rawat-inap';
import { getEdItem, getIgdView } from '@/lib/server/data/klinis/igd';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * K03 · Server Action IGD (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + posisi, kontrak zod, lalu aturan
 * dibaca dari papan IGD server (fixture + toko demo `klinis-igd`, ADR-0085), bukan dari klien. Triase, pasien datang
 * sendiri, dokter penanggung jawab, permintaan bed, dan disposisi meninggal tersimpan atas nama pengguna sesi.
 * Pasien skenario dicatat lewat langkah skenario.
 */

const revSchema = z.int().min(0);
const SCENARIO = 'Pasien simulasi dicatat lewat langkah skenario.';
const UNKNOWN = 'Pasien IGD tidak dikenal.';

export interface TriageActionResult extends RekamActionResult {
  at?: string;
  orders?: number;
  override?: boolean;
}

/**
 * Simpan triase: saran sistem dan batas protokol dibaca dari data IGD server; level di bawah saran wajib alasan
 * (tercatat untuk jejak audit); level di atas batas protokol ditolak.
 */
export async function saveTriageAction(input: unknown, rev: unknown): Promise<TriageActionResult> {
  const s = await klinisSession('igd');
  if (!s) return REKAM_DENIED;
  if (!canTriage(s.role?.code)) return rekamFail(`${TRIAGE_ROLE_REASON}.`);
  const parsed = z
    .strictObject({ triage: triageAssessmentSchema, chiefComplaint: z.string().trim().min(1).max(120) })
    .safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) {
    return rekamFail(parsed.error?.issues[0]?.message ?? 'Data triase tidak valid.');
  }
  const t = parsed.data.triage;
  const item = await getEdItem(s, t.encounterId);
  if (!item) return rekamFail(UNKNOWN);
  if (item.scenario) return rekamFail('Triase pasien simulasi dicatat lewat langkah skenario.');
  const blocked = triageBlocker(item, t.chosenLevel, t.overrideReason ?? '');
  if (blocked) return rekamFail(blocked);
  const override = triageNeedsReason(item.suggestedLevel, t.chosenLevel);
  const at = wib(demoNow());
  const c = await commitEvent(
    'klinis-igd',
    {
      type: 'triase.disimpan',
      encounterId: item.encounterId,
      level: t.chosenLevel,
      suggestedLevel: item.suggestedLevel,
      overrideReason: override ? (t.overrideReason?.trim() ?? null) : null,
      orders: t.orders.filter((o) => item.orders.some((x) => x.label === o)),
      chiefComplaint: parsed.data.chiefComplaint,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: 'Triase tersimpan.',
    at: formatJam(at),
    orders: t.orders.length,
    override,
  });
}

/** Pasien datang sendiri / tanpa identitas masuk area triase (id sementara dibangkitkan server). */
export async function addWalkInAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { encounterId?: string }> {
  const s = await klinisSession('igd');
  if (!s) return REKAM_DENIED;
  const p = z.strictObject({ kind: z.enum(['tanpa-identitas', 'baru']) }).safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Jenis pasien tidak dikenal.');
  const { state } = await readDomain('klinis-igd');
  const n = state.walkIns.filter((w) => w.kind === p.data.kind).length + 1;
  if (n > 50) return rekamFail('Area triase penuh di data demo; mulai ulang data demo.');
  const encounterId = walkInEncounterId(p.data.kind, n);
  const c = await commitEvent(
    'klinis-igd',
    { type: 'pasien.datang', encounterId, kind: p.data.kind, arrivedAt: wib(demoNow()) },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: 'Pasien masuk area triase.', encounterId });
}

const encounterInput = z.strictObject({ encounterId: z.string().min(1).max(60) });

/** Dokter sesi menjadi dokter penanggung jawab pasien IGD ini (relasi dokter–pasien untuk disposisi). */
export async function assignDoctorAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('igd');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail('Dokter penanggung jawab IGD adalah posisi dokter.');
  const p = encounterInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail(UNKNOWN);
  const item = await getEdItem(s, p.data.encounterId);
  if (!item) return rekamFail(UNKNOWN);
  if (item.scenario) return rekamFail(SCENARIO);
  if (item.doctor === s.user.displayName) return rekamFail('Anda sudah dokter penanggung jawab pasien ini.');
  const c = await commitEvent(
    'klinis-igd',
    { type: 'dokter.ditetapkan', encounterId: item.encounterId, at: wib(demoNow()) },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `${s.user.displayName} kini dokter penanggung jawab ${item.patientName}.`,
  });
}

const admissionInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  kelas: z.enum(WARD_CLASSES),
  need: z.string().trim().min(3, 'Tulis kebutuhan ruang (minimal 3 karakter).').max(80),
});

/** Disposisi rawat inap: permintaan bed masuk antrean papan tempat tidur (dokter/residen). */
export async function requestAdmissionAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('igd');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter' && s.role?.code !== 'dokter_residen') {
    return rekamFail('Keputusan rawat inap oleh dokter (DPJP/dokter jaga).');
  }
  const p = admissionInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success)
    return rekamFail(p.error?.issues[0]?.message ?? 'Permintaan bed tidak valid.');
  const view = await getIgdView(s);
  const item = view.board.items.find((x) => x.encounterId === p.data.encounterId);
  if (view.state.death[p.data.encounterId]) return rekamFail(DEAD_NO_ADMISSION);
  if (!item) return rekamFail(UNKNOWN);
  if (item.scenario) return rekamFail(SCENARIO);
  if (item.triageLevel === null) return rekamFail('Triase pasien dulu sebelum disposisi rawat inap.');
  if (view.dispositions[item.encounterId]?.bedRequested)
    return rekamFail('Permintaan bed pasien ini sudah ada.');
  const pt = item.patientId ? patientById(item.patientId) : null;
  const age = pt?.umur ?? Number(/\d+/.exec(item.ageLabel)?.[0] ?? '0');
  const c = await commitEvent(
    'klinis-igd',
    {
      type: 'admisi.diminta',
      encounterId: item.encounterId,
      requestId: igdBedRequestId(item.encounterId),
      patientId: item.patientId,
      patientName: item.patientName,
      rm: item.rm,
      sex: item.sex,
      ageYears: Math.min(130, Math.max(0, age)),
      from: `IGD ${item.bed ?? 'area triase'}`,
      need: p.data.need,
      kelas: p.data.kelas,
      at: wib(demoNow()),
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Permintaan bed ${p.data.kelas} terkirim ke papan tempat tidur · ${formatJam(demoNow())}.`,
  });
}

const deathInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  /** Jam kematian `HH.MM` hari ini (WIB). */
  diedAt: z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/, 'Jam kematian HH.MM.'),
  causeCode: z.string().min(1).max(10),
  /** Dokter menandatangani surat keterangan kematian (TTE). */
  certificateSigned: z.literal(true),
});

/**
 * Disposisi meninggal (usulan K-1, menunggu konfirmasi pemilik produk): hanya dokter penanggung jawab pasien (relasi
 * dari sesi), jam kematian tidak sebelum kedatangan dan tidak di masa depan, sebab kematian ICD-10 dari seed, surat
 * keterangan kematian ber-TTE. Setelah itu admisi pasien ditolak.
 */
export async function declareDeathAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { certificateNo?: string }> {
  const s = await klinisSession('igd');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail('Pernyataan meninggal hanya oleh dokter (posisi dokter).');
  const p = deathInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) {
    return rekamFail(
      p.error?.issues.some((i) => i.path[0] === 'certificateSigned')
        ? 'Surat keterangan kematian wajib ditandatangani (TTE).'
        : (p.error?.issues[0]?.message ?? 'Disposisi meninggal tidak valid.'),
    );
  }
  const item = await getEdItem(s, p.data.encounterId);
  if (!item) return rekamFail(UNKNOWN);
  if (item.scenario) return rekamFail(SCENARIO);
  if (item.doctor !== s.user.displayName) {
    return rekamFail('Hanya dokter penanggung jawab pasien ini yang dapat menyatakan meninggal.');
  }
  const cause = DEATH_CAUSES.find((c) => c.code === p.data.causeCode);
  if (!cause) return rekamFail('Pilih sebab kematian ICD-10 dari daftar.');
  const now = demoNow();
  const day = wib(now).slice(0, 10);
  const diedAt = `${day}T${p.data.diedAt.replace('.', ':')}:00+07:00`;
  if (Date.parse(diedAt) > now.getTime()) return rekamFail('Jam kematian tidak boleh di masa depan.');
  if (Date.parse(diedAt) < Date.parse(item.arrivedAt)) {
    return rekamFail(`Jam kematian tidak boleh sebelum pasien tiba (${formatJam(item.arrivedAt)}).`);
  }
  const { state } = await readDomain('klinis-igd');
  const no = certificateNo(s.tenant.code, Object.keys(state.death).length + 1);
  const c = await commitEvent(
    'klinis-igd',
    {
      type: 'pasien.meninggal',
      encounterId: item.encounterId,
      patientId: item.patientId,
      patientName: item.patientName,
      diedAt,
      causeCode: cause.code,
      causeLabel: cause.display,
      certificateNo: no,
      at: wib(now),
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `${item.patientName} dinyatakan meninggal ${p.data.diedAt} · ${cause.code} ${cause.display} · surat keterangan kematian ${no} ber-TTE.`,
    certificateNo: no,
  });
}
