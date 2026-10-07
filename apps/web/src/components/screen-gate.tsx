import { Alert } from '@simrs/ui';
import type { ReactNode } from 'react';
import type { ScreenDef } from '@/lib/screens';

/**
 * Tampilan gerbang layar hibrida di mode api (`requireScreen`, rencana fase 2 potongan 0c): akses ditolak bila peran
 * tidak memegang izin layar, dan "Belum tersambung" selama potongan fase 2–3 yang mengisi jalur api belum tergabung.
 * Layar perangkat (anjungan, TV) berbicara kepada pasien; layar staf kepada petugas.
 */

interface Copy {
  /** Teks untuk petugas (layar staf) atau pasien (layar perangkat). */
  body: string;
  /** Teks khusus per peran (kode peran sistem), menimpa `body`. */
  byRole?: Readonly<Record<string, string>>;
}

/**
 * Teks "Belum tersambung" hanya untuk layar hibrida yang jalur api-nya belum dibangun (penunjang fase 4). Layar yang
 * sudah tersambung (front office fase 2, semua layar klinis fase 3 W1–W5b dan 3.8) tidak ada di sini; layar tanpa entri
 * memakai kalimat umum.
 */
const NOT_CONNECTED: Readonly<Record<string, Copy>> = {
  // Layar penunjang fase 4 (potongan 4.0c): jalur api diisi potongan 4.2–4.9 setelah modul API penunjangnya tergabung.
  lab: {
    body: 'Worklist laboratorium, penerimaan spesimen, input hasil, validasi, dan pelaporan nilai kritis akan tersedia di sini setelah modul laboratorium tersambung ke server SIM RS. Sementara itu, ikuti prosedur cadangan laboratorium.',
  },
  rad: {
    body: 'Jadwal modalitas, pelaksanaan pemeriksaan, dan ekspertise radiologi ber-TTE akan tersedia di sini setelah modul radiologi tersambung ke server SIM RS. Sementara itu, ikuti prosedur cadangan radiologi.',
  },
  farmasi: {
    body: 'Telaah resep, penyiapan dengan cek ganda, dan serah terima obat akan tersedia di sini setelah modul farmasi tersambung ke server SIM RS. Sementara itu, layani resep dengan prosedur cadangan farmasi.',
  },
  ok: {
    body: 'Jadwal kamar operasi, daftar tilik keselamatan WHO, hitung kasa, dan laporan operasi akan tersedia di sini setelah modul kamar operasi tersambung ke server SIM RS. Sementara itu, gunakan daftar tilik kertas sesuai prosedur rumah sakit.',
  },
  kritis: {
    body: 'Nilai kritis lintas unit dengan batas waktu lapor, read-back, dan eskalasi akan tersedia di sini setelah modul nilai kritis tersambung ke server SIM RS. Sementara itu, laporkan nilai kritis lewat telepon dengan read-back sesuai prosedur.',
  },
  depo: {
    body: 'Stok depo per batch dan kedaluwarsa, mutasi antardepo, dan penyesuaian stok akan tersedia di sini setelah modul stok tersambung ke server SIM RS. Sementara itu, catat mutasi stok dengan prosedur cadangan farmasi.',
  },
  'bank-darah': {
    body: 'Permintaan darah, crossmatch, dan pengeluaran kantong dengan cek ganda akan tersedia di sini setelah modul bank darah tersambung ke server SIM RS. Sementara itu, ikuti prosedur cadangan bank darah.',
  },
  gizi: {
    body: 'Order diet, skrining gizi, dan distribusi makan per bangsal akan tersedia di sini setelah modul gizi tersambung ke server SIM RS. Sementara itu, ikuti prosedur cadangan instalasi gizi.',
  },
  mikro: {
    body: 'Kultur, uji kepekaan, dan ekspertise patologi anatomi akan tersedia di sini setelah modul mikrobiologi dan PA tersambung ke server SIM RS. Sementara itu, ikuti prosedur cadangan laboratorium.',
  },
  diagnostik: {
    body: 'Order, jadwal, dan laporan diagnostik lain (EKG, ekokardiografi, endoskopi) ber-TTE akan tersedia di sini setelah modulnya tersambung ke server SIM RS. Sementara itu, ikuti prosedur cadangan unit diagnostik.',
  },
};

function Frame({ screen, children }: { screen: ScreenDef; children: ReactNode }) {
  if (screen.layout === 'staf') return <div className="flex max-w-3xl flex-col gap-4">{children}</div>;
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-card border border-line bg-white p-8">
        {children}
      </div>
    </div>
  );
}

/** Mode api: peran aktif tidak memegang izin layar ini. */
export function ScreenAccessDenied({ screen }: { screen: ScreenDef }) {
  return (
    <Frame screen={screen}>
      <h1 className="m-0 text-h1 font-semibold">{screen.label}</h1>
      <Alert level="warning" title="Akses ditolak">
        Peran Anda tidak memiliki izin untuk layar {screen.label}. Hubungi admin SIM RS bila Anda
        membutuhkannya.
      </Alert>
    </Frame>
  );
}

/** Mode api: layar sudah berizin, tetapi jalur datanya belum diisi potongan fase 2–3. */
export function ScreenNotConnected({ screen, role }: { screen: ScreenDef; role: string | null }) {
  const copy = NOT_CONNECTED[screen.id];
  const body =
    (role ? copy?.byRole?.[role] : undefined) ??
    copy?.body ??
    `Layar ${screen.label} belum tersambung ke server SIM RS.`;
  return (
    <Frame screen={screen}>
      <h1 className="m-0 text-h1 font-semibold">{screen.label}</h1>
      <Alert level="info" title="Belum tersambung">
        {body}
      </Alert>
    </Frame>
  );
}
