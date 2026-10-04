import type { PatientAppHome } from '@simrs/shared';
import type { AppPage, AppRow, RowTone } from '@/components/manajemen/app-page-view';

export const SUB_KEYS = [
  'daftar',
  'lab',
  'resume',
  'obat',
  'tagihan',
  'keluarga',
  'tanya',
  'privasi',
] as const;
export type SubKey = (typeof SUB_KEYS)[number];
export type TabKey = 'beranda' | 'jadwal' | 'notif' | 'profil';

export function isSubKey(k: string): k is SubKey {
  return (SUB_KEYS as readonly string[]).includes(k);
}

const FLAG: Record<PatientAppHome['labResults'][number]['flag'], { label: string; tone: RowTone }> = {
  normal: { label: 'Normal', tone: 'ok' },
  tinggi: { label: 'Tinggi', tone: 'bad' },
  rendah: { label: 'Rendah', tone: 'bad' },
};

const QUEUE_STATUS: Record<PatientAppHome['queue']['stage'], { label: string; tone: RowTone }> = {
  booking: { label: 'Terdaftar', tone: 'brand' },
  admisi: { label: 'Check-in', tone: 'brand' },
  poli: { label: 'Dalam antrean', tone: 'warn' },
  pulang: { label: 'Selesai', tone: 'ok' },
};

/** Halaman menu dan tab aplikasi pasien (mockup AppPasien), diisi dari proyeksi skenario rawat jalan. */
export function buildPatientPages(h: PatientAppHome): Record<SubKey | Exclude<TabKey, 'beranda'>, AppPage> {
  const q = h.queue;
  const has = (id: string) => h.feed.some((f) => f.id === id);
  const control: AppRow[] = h.controlVisit
    ? [
        {
          id: 'kontrol',
          title: 'Kontrol berikutnya',
          detail: h.controlVisit.label,
          value: h.controlVisit.date,
          status: 'Terjadwal',
          tone: 'ok',
        },
      ]
    : [];
  const today: AppRow = {
    id: 'hari-ini',
    title: 'Poli Penyakit Dalam',
    detail: `Hari ini · ${q.numberLabel.toLowerCase()} ${q.number}`,
    value: q.number,
    status: QUEUE_STATUS[q.stage].label,
    tone: QUEUE_STATUS[q.stage].tone,
  };
  return {
    daftar: {
      title: 'Daftar berobat',
      intro: 'Pendaftaran online poli rawat jalan, terhubung dengan antrean BPJS.',
      rows: [
        today,
        ...control,
        {
          id: 'lain',
          title: 'Daftar ke poli lain',
          detail: 'Pilih poli, dokter, dan jam praktik',
          status: 'Rujukan aktif',
          tone: 'muted',
        },
      ],
      note: 'Pendaftaran ditutup H-1 pukul 20.00. Bawa kartu BPJS atau KTP saat datang.',
    },
    lab: {
      title: 'Hasil lab',
      intro: h.labStatus,
      rows: h.labResults.map((r) => ({
        id: r.id,
        title: r.name,
        detail: r.reference,
        value: r.value,
        status: FLAG[r.flag].label,
        tone: FLAG[r.flag].tone,
      })),
      empty: 'Belum ada hasil yang dirilis untuk Anda.',
      note: 'Nilai di luar rujukan dibahas dokter saat kontrol. Jangan ubah dosis obat sendiri.',
    },
    resume: {
      title: 'Resume medis',
      intro: 'Dokumen resmi yang ditandatangani dokter secara elektronik.',
      rows: [
        has('resume')
          ? {
              id: 'rj',
              title: 'Resume rawat jalan',
              detail: 'Poli Penyakit Dalam · 5 Okt 2026',
              status: 'Final · TTE',
              tone: 'ok',
            }
          : {
              id: 'rj',
              title: 'Resume rawat jalan',
              detail: 'Tersedia setelah kunjungan hari ini selesai',
              status: 'Belum ada',
              tone: 'muted',
            },
        {
          id: 'ri',
          title: 'Resume rawat inap',
          detail: 'Hipoglikemia berat · 2025',
          status: 'Final · TTE',
          tone: 'ok',
        },
      ],
      note: 'Resume juga terkirim ke SATUSEHAT sesuai ketentuan Kemenkes.',
    },
    obat: {
      title: 'Obat saya',
      intro: h.medicinesStatus,
      rows: h.medicines.map((m) => ({
        id: m.id,
        title: m.name,
        detail: m.instruction,
        status: 'Aktif',
        tone: 'brand',
      })),
      empty: 'Belum ada obat dari kunjungan hari ini.',
      note: 'Pengingat minum obat dikirim lewat notifikasi aplikasi.',
    },
    tagihan: {
      title: 'Tagihan',
      intro: 'Riwayat tagihan dan pembayaran atas nama Anda.',
      rows: [
        {
          id: 'rj',
          title: 'Kunjungan Poli Penyakit Dalam',
          detail: has('kasir') ? 'Dijamin BPJS · 5 Okt 2026' : 'Dalam proses · dijamin BPJS',
          value: 'Rp 0',
          status: has('kasir') ? 'Selesai' : 'Proses',
          tone: has('kasir') ? 'ok' : 'muted',
        },
      ],
      note: 'Tidak ada tagihan yang perlu dibayar saat ini.',
    },
    keluarga: {
      title: 'Keluarga',
      intro: 'Hubungkan anggota keluarga agar bisa mendaftarkan dan melihat jadwal mereka.',
      rows: [
        {
          id: 'kosong',
          title: 'Belum ada anggota keluarga',
          detail: 'Tambahkan di loket pendaftaran dengan membawa KK',
          tone: 'muted',
        },
      ],
      note: 'Akses keluarga ke data medis Anda hanya diberikan dengan persetujuan tertulis.',
    },
    tanya: {
      title: 'Tanya RS',
      intro: 'Pertanyaan non-darurat dijawab petugas pada jam layanan.',
      rows: [
        {
          id: 'chat',
          title: 'Pesan ke petugas',
          detail: 'Setiap hari 07.00–21.00',
          status: 'Buka',
          tone: 'ok',
        },
        {
          id: 'darurat',
          title: 'Keadaan darurat',
          detail: 'Datang langsung ke IGD 24 jam atau hubungi 119',
          status: 'Darurat',
          tone: 'bad',
        },
      ],
      note: 'Jangan kirim foto dokumen identitas lewat pesan.',
    },
    privasi: {
      title: 'Data & privasi',
      intro: 'Kendalikan siapa yang dapat melihat data kesehatan Anda.',
      rows: [
        {
          id: 'akses',
          title: 'Akses rekam medis',
          detail: 'Hanya tenaga kesehatan yang merawat · setiap akses tercatat',
          status: 'Tercatat',
          tone: 'ok',
        },
        {
          id: 'satusehat',
          title: 'Berbagi ke SATUSEHAT',
          detail: 'Sesuai ketentuan Kemenkes',
          status: 'Aktif',
          tone: 'ok',
        },
        {
          id: 'salinan',
          title: 'Salinan data pribadi',
          detail: 'Ajukan unduhan rekam medis Anda',
          status: 'Tersedia',
          tone: 'muted',
        },
      ],
      note: 'Data diproses sesuai UU Pelindungan Data Pribadi.',
    },
    jadwal: {
      title: 'Jadwal',
      intro: 'Kunjungan dan pengingat yang akan datang.',
      rows: [
        ...(q.stage === 'pulang' ? [] : [today]),
        ...control,
        ...h.medicines.map((m) => ({
          id: `ingat-${m.id}`,
          title: m.name,
          detail: m.instruction,
          status: 'Pengingat aktif',
          tone: 'warn' as const,
        })),
        {
          id: 'gula',
          title: 'Cek gula darah mandiri',
          detail: 'Sebelum sarapan',
          value: 'Pagi',
          status: 'Setiap hari',
          tone: 'muted',
        },
      ],
      note: 'Ubah atau batalkan jadwal kontrol paling lambat H-1.',
    },
    notif: {
      title: 'Notifikasi',
      intro: 'Pemberitahuan dari rumah sakit untuk Anda.',
      rows: h.feed.map((f) => ({ id: f.id, title: f.title, detail: f.detail, value: f.when, tone: 'muted' })),
      note: 'Notifikasi penting juga dikirim lewat SMS.',
    },
    profil: {
      title: 'Profil',
      intro: `${h.fullName} · RM ${h.rm}`,
      rows: [
        { id: 'penjamin', title: 'Penjamin', detail: h.payer, status: 'Aktif', tone: 'ok' },
        {
          id: 'hp',
          title: 'Nomor HP',
          detail: 'Dipakai untuk notifikasi dan masuk aplikasi',
          status: 'Terverifikasi',
          tone: 'ok',
        },
        { id: 'keluarga', title: 'Keluarga', detail: 'Anggota keluarga yang terhubung', link: 'keluarga' },
        {
          id: 'privasi',
          title: 'Data & privasi',
          detail: 'Akses data dan persetujuan berbagi',
          link: 'privasi',
        },
        { id: 'tagihan', title: 'Tagihan', detail: 'Riwayat tagihan dan pembayaran', link: 'tagihan' },
      ],
      note: 'Perubahan data identitas dilakukan di loket pendaftaran dengan KTP.',
    },
  };
}
