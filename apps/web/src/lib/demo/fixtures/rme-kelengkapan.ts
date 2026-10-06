import type { CheckItem, PatientDocument } from '../../rme-kelengkapan';
import { formatJam } from '@simrs/shared';
import { type AssessmentResponse, latestResponse } from '../../rme-asesmen';
import { type EncounterDx, primaryDx } from '../../rme-diagnosis';
import { type EduRecord, topicCoverage } from '../../rme-edukasi';
import { latestEntries } from '../../rme-cppt';
import { ENCOUNTER_ID } from './ids';
import { at } from './rawat-inap';
import { assessmentResponsesFor } from './rme-asesmen';
import { encounterCoding } from './rme-diagnosis';
import { EDU_RECORDS, requiredTopics } from './rme-edukasi';
import { chartPatient, type RmeChart } from './rme-pasien';
import { STAF, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K13 · Dokumen pasien dan daftar periksa kelengkapan sebelum tutup kunjungan. Butir dihitung dari fixture layar RME
 * lain (asesmen, CPPT, diagnosis, edukasi) agar konsisten; dokumen Ny. Endang selaras worklist: resume menunggu TTE
 * DPJP, surat kontrol gagal TTE (layanan TTE tidak merespons).
 */

const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);

const ENDANG_DOCS: PatientDocument[] = [
  {
    id: `${ENCOUNTER_ID.endang}-dok-1`,
    title: 'Persetujuan umum rawat inap',
    kind: 'Persetujuan',
    status: 'final-tte',
    by: STAF_LAIN.perawat[0],
    at: T('09.40', -4),
    note: null,
  },
  {
    id: `${ENCOUNTER_ID.endang}-dok-2`,
    title: 'Asesmen awal medis',
    kind: 'Asesmen',
    status: 'final',
    by: STAF.dpjpPenyakitDalam,
    at: T('10.40', -4),
    note: null,
  },
  {
    id: `${ENCOUNTER_ID.endang}-dok-3`,
    title: 'Hasil lab luar RS (pindaian)',
    kind: 'Pindaian',
    status: 'terunggah',
    by: STAF_LAIN.perawat[0],
    at: T('10.20', -4),
    note: null,
  },
  {
    id: `${ENCOUNTER_ID.endang}-dok-4`,
    title: 'Resep pulang',
    kind: 'Resep',
    status: 'final-tte',
    by: STAF.dpjpPenyakitDalam,
    at: T('09.30'),
    note: null,
  },
  {
    id: `${ENCOUNTER_ID.endang}-dok-5`,
    title: 'Resume medis pulang',
    kind: 'Resume',
    status: 'menunggu-tte',
    by: STAF.dpjpPenyakitDalam,
    at: T('09.45'),
    note: '11 dari 12 butir lengkap; rekonsiliasi obat pulang belum',
  },
  {
    id: `${ENCOUNTER_ID.endang}-dok-6`,
    title: 'Surat kontrol Poli Penyakit Dalam',
    kind: 'Surat',
    status: 'tte-gagal',
    by: STAF.dpjpPenyakitDalam,
    at: T('10.02'),
    note: 'Layanan TTE tidak merespons (percobaan 3 dari 3)',
  },
];

export function patientDocuments(chart: RmeChart): PatientDocument[] {
  if (chart.encounterId === ENCOUNTER_ID.endang) return ENDANG_DOCS.map((d) => ({ ...d }));
  return [
    {
      id: `${chart.encounterId}-dok-1`,
      title: chart.setting === 'rawat-inap' ? 'Persetujuan umum rawat inap' : 'Persetujuan umum rawat jalan',
      kind: 'Persetujuan',
      status: 'final-tte',
      by: STAF_LAIN.perawat[1],
      at: at(chart.startedOn, '09.00'),
      note: null,
    },
  ];
}

/**
 * Sumber daftar periksa dari layar RME lain (toko demo `rekam-medis`, ADR-0085). Tanpa sumber = rekam awal fixture.
 */
export interface CloseSources {
  responses?: readonly AssessmentResponse[];
  dx?: readonly EncounterDx[];
  edu?: readonly EduRecord[];
  /** Dokumen awal (fixture): dasar butir "TTE gagal" yang tetap tampil setelah dikirim ulang/dibatalkan. */
  baseDocs?: readonly PatientDocument[];
}

/** Daftar periksa DPJP sebelum menutup kunjungan, dihitung dari data layar RME. */
export function closeChecklist(
  chart: RmeChart,
  docs: readonly PatientDocument[],
  src: CloseSources = {},
): CheckItem[] {
  const enc = chart.encounterId;
  const responses =
    src.responses ?? assessmentResponsesFor({ ...chart, riwayat: chartPatient(chart).riwayat });
  const pendingCosign = chart.inpatient
    ? latestEntries(chart.inpatient.cppt).filter((e) => e.cosignRequired && !e.cosignedBy).length
    : 0;
  const dx = src.dx ?? encounterCoding(chart).dx;
  const cov = topicCoverage(src.edu ?? EDU_RECORDS[enc] ?? [], requiredTopics(chart));
  const eduOpen = [...cov.ulang, ...cov.belum];
  const resume = docs.find((d) => d.kind === 'Resume');
  const failed = (src.baseDocs ?? docs).filter((d) => d.status === 'tte-gagal');
  const now = (id: string) => docs.find((d) => d.id === id);
  const items: CheckItem[] = [
    {
      id: 'asesmen-medis',
      label: 'Asesmen awal medis ≤ 24 jam',
      done: !!latestResponse(responses, 'asesmen_awal_medis'),
      detail: latestResponse(responses, 'asesmen_awal_medis') ? 'Final' : 'Belum diisi',
      fix: { kind: 'layar', screen: 'asesmen' },
    },
    {
      id: 'asesmen-keperawatan',
      label: 'Asesmen awal keperawatan',
      done: !!latestResponse(responses, 'asesmen_awal_keperawatan'),
      detail: latestResponse(responses, 'asesmen_awal_keperawatan') ? 'Final' : 'Belum diisi',
      fix: { kind: 'layar', screen: 'asesmen' },
    },
    {
      id: 'cosign',
      label: 'Semua CPPT residen sudah co-sign DPJP',
      done: pendingCosign === 0,
      detail:
        pendingCosign === 0 ? 'Tidak ada yang menunggu' : `${pendingCosign} catatan residen menunggu co-sign`,
      fix: { kind: 'cosign' },
    },
    {
      id: 'diagnosis',
      label: 'Tepat satu diagnosis utama berkode ICD-10',
      done: primaryDx(dx).length === 1,
      detail: primaryDx(dx)[0]
        ? `${primaryDx(dx)[0]?.code} ${primaryDx(dx)[0]?.display}`
        : 'Belum ada diagnosis utama',
      fix: { kind: 'layar', screen: 'diagnosis' },
    },
    {
      id: 'edukasi',
      label: 'Edukasi pulang terverifikasi paham',
      done: eduOpen.length === 0,
      detail:
        eduOpen.length === 0
          ? 'Semua materi wajib paham'
          : `${eduOpen.length} materi belum terverifikasi paham`,
      fix: { kind: 'layar', screen: 'edukasi' },
    },
    ...failed.map((d): CheckItem => {
      const cur = now(d.id);
      const ok = cur?.status === 'final-tte';
      const gone = cur?.status === 'dibatalkan';
      return {
        id: `tte-${d.id}`,
        label: `${d.title} ber-TTE`,
        done: ok || gone,
        detail: ok
          ? `TTE berhasil ${formatJam(cur.at)}`
          : gone
            ? `Dokumen dibatalkan ${formatJam(cur.at)}`
            : `TTE gagal: ${d.note ?? ''}`,
        fix: { kind: 'tte-ulang', documentId: d.id },
      };
    }),
  ];
  if (chart.setting === 'rawat-inap') {
    items.push({
      id: 'resume',
      label: 'Resume medis final ber-TTE',
      done: resume?.status === 'final-tte',
      detail: resume
        ? `${resume.status === 'final-tte' ? 'Final · TTE' : 'Menunggu TTE DPJP'}${resume.note ? ` · ${resume.note}` : ''}`
        : 'Belum disusun',
      fix: { kind: 'layar', screen: 'resume', suffix: `/${enc}` },
    });
  }
  return items;
}
