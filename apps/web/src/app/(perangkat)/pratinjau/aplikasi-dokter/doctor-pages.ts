import type { DoctorAppInbox } from '@simrs/shared';
import type { AppPage, AppRow } from '@/components/manajemen/app-page-view';

export type DoctorTab = 'pasien' | 'tugas' | 'jadwal' | 'profil';

/** Status nilai kritis untuk baris tugas dan detail pasien. */
export function criticalStatus(c: DoctorAppInbox['critical'], accepted: string | null): AppRow['tone'] {
  return accepted ? 'ok' : c.state === 'menunggu-hasil' ? 'muted' : 'bad';
}

export function criticalText(c: DoctorAppInbox['critical'], accepted: string | null): string {
  if (accepted) return `${c.value} ${c.unit} · kritis, diterima ${accepted} (read-back tercatat)`;
  if (c.state === 'menunggu-hasil') return 'Menunggu hasil lab';
  return `${c.value} ${c.unit} · kritis, belum diterima dokter`;
}

/** Halaman tab Tugas, Jadwal, dan Profil aplikasi dokter (mockup AppDokter). */
export function buildDoctorPages(
  d: DoctorAppInbox,
  accepted: string | null,
  cosignLeft: number,
  nextCosign: string | null,
): Record<Exclude<DoctorTab, 'pasien'>, AppPage> {
  const c = d.critical;
  return {
    tugas: {
      title: 'Tugas',
      intro: 'Pekerjaan yang menunggu tindakan Anda hari ini.',
      rows: [
        {
          id: 'kritis',
          title: 'Nilai kritis',
          detail: `${c.analyte} ${c.value} · ${c.patientName}`,
          status: accepted
            ? `Diterima ${accepted}`
            : c.state === 'menunggu-hasil'
              ? 'Belum ada'
              : 'Belum diterima',
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
      note: 'Keluar dari aplikasi lewat menu akun di perangkat.',
    },
  };
}
