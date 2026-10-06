import type { DoctorAppInbox } from '@simrs/shared';
import type { AppPage, AppRow } from '@/components/manajemen/app-page-view';

export type DoctorTab = 'pasien' | 'tugas' | 'jadwal' | 'profil';

type Critical = DoctorAppInbox['critical'];

/** Nilai kritis masih menunggu hasil lab: analit dan nilainya belum boleh tampil. */
const waitingResult = (c: Critical, accepted: string | null) => !accepted && c.state === 'menunggu-hasil';

/** Status nilai kritis untuk baris tugas dan detail pasien. */
export function criticalStatus(c: Critical, accepted: string | null): AppRow['tone'] {
  return accepted ? 'ok' : c.state === 'menunggu-hasil' ? 'muted' : 'bad';
}

/** Isi kartu nilai kritis selama menunggu hasil: "belum ada order lab" ≠ "hasil sedang diproses". */
export function criticalPendingText(c: Critical, labOrdered: boolean): string {
  return labOrdered
    ? `Hasil lab ${c.patientName} (troponin I, elektrolit) sedang diproses.`
    : 'Belum ada order lab yang menunggu hasil.';
}

/** Baris nilai kritis di detail pasien skenario; `danger` = kritis dan belum diterima dokter. */
export function criticalDetailRow(
  c: Critical,
  accepted: string | null,
  labOrdered: boolean,
): { label: string; value: string; danger: boolean } {
  if (accepted) {
    return {
      label: c.analyte,
      value: `${c.value} ${c.unit} · kritis, diterima ${accepted} (read-back tercatat)`,
      danger: false,
    };
  }
  if (waitingResult(c, accepted)) {
    return {
      label: 'Hasil lab',
      value: labOrdered ? 'Order terkirim · hasil sedang diproses' : 'Belum ada order lab',
      danger: false,
    };
  }
  return { label: c.analyte, value: `${c.value} ${c.unit} · kritis, belum diterima dokter`, danger: true };
}

/** Halaman tab Tugas, Jadwal, dan Profil aplikasi dokter (mockup AppDokter). */
export function buildDoctorPages(
  d: DoctorAppInbox,
  opts: { accepted: string | null; labOrdered: boolean; cosignLeft: number; nextCosign: string | null },
): Record<Exclude<DoctorTab, 'pasien'>, AppPage> {
  const c = d.critical;
  const { accepted, labOrdered, cosignLeft, nextCosign } = opts;
  const waiting = waitingResult(c, accepted);
  return {
    tugas: {
      title: 'Tugas',
      intro: 'Pekerjaan yang menunggu tindakan Anda hari ini.',
      rows: [
        {
          id: 'kritis',
          title: 'Nilai kritis',
          detail: !waiting
            ? `${c.analyte} ${c.value} · ${c.patientName}`
            : labOrdered
              ? `Hasil lab ${c.patientName} sedang diproses`
              : 'Belum ada order lab yang menunggu hasil',
          status: accepted
            ? `Diterima ${accepted}`
            : !waiting
              ? 'Belum diterima'
              : labOrdered
                ? 'Diproses'
                : 'Belum ada',
          tone: criticalStatus(c, accepted),
        },
        {
          id: 'cosign',
          title: 'Co-sign CPPT residen',
          detail: nextCosign ? `Berikutnya: ${nextCosign}` : 'Semua sudah ditandatangani',
          status: cosignLeft ? `${cosignLeft} menunggu` : 'Selesai',
          tone: cosignLeft ? 'brand' : 'ok',
        },
        {
          id: 'order',
          title: 'Order perlu verifikasi',
          detail: 'Usulan apoteker penyesuaian dosis antikoagulan',
          status: `${d.orderVerifyCount} order`,
          tone: 'warn',
        },
        {
          id: 'koder',
          title: 'Query koder',
          detail: 'Resume pasien sepsis belum final',
          status: `${d.coderQueryCount} query`,
          tone: 'brand',
        },
      ],
      note: 'Nilai kritis yang tidak dibaca dalam 5 menit diteruskan lewat telepon.',
    },
    jadwal: {
      title: 'Jadwal jaga',
      intro: 'Hari ini · jaga konsulen penyakit dalam.',
      rows: d.schedule.map((s) => ({ id: s.id, title: s.title, detail: s.detail, value: s.time })),
      note: 'Perubahan jadwal jaga diatur komite medik.',
    },
    profil: {
      title: 'Profil',
      intro: `${d.doctorName} · ${d.doctorRole}`,
      rows: [
        {
          id: 'sip',
          title: 'Surat izin praktik',
          detail: 'SIP aktif di rumah sakit ini',
          status: 'Aktif',
          tone: 'ok',
        },
        {
          id: 'tte',
          title: 'Tanda tangan elektronik',
          detail: 'Sertifikat TTE untuk CPPT, resep, dan resume',
          status: 'Aktif',
          tone: 'ok',
        },
        {
          id: 'notif',
          title: 'Notifikasi nilai kritis',
          detail: 'Push dan telepon bila tidak dibaca 5 menit',
          status: 'Aktif',
          tone: 'ok',
        },
        {
          id: 'kewenangan',
          title: 'Kewenangan klinis',
          detail: 'Sesuai rincian kewenangan dari komite medik',
          status: 'Berlaku',
          tone: 'muted',
        },
      ],
      note: 'Perubahan SIP dan kewenangan klinis diurus lewat komite medik.',
    },
  };
}
