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

const NOT_CONNECTED: Readonly<Record<string, Copy>> = {
  jadwal: {
    body: 'Jadwal praktik dan kuota dokter akan tampil di sini setelah modul jadwal tersambung ke server SIM RS. Sementara itu, ikuti prosedur jadwal yang berlaku di rumah sakit.',
    byRole: {
      dokter:
        'Jadwal praktik Anda dan jumlah pasien yang sudah booking akan tampil di sini setelah modul jadwal tersambung ke server SIM RS.',
    },
  },
  daftar: {
    body: 'Pencarian pasien, cek kepesertaan BPJS, rujukan, dan penerbitan SEP akan tersedia di sini setelah modul pendaftaran tersambung ke server SIM RS. Sementara itu, layani pendaftaran dengan prosedur cadangan rumah sakit.',
  },
  kiosk: {
    body: 'Anjungan pendaftaran mandiri belum dapat dipakai. Silakan ambil nomor antrean di loket pendaftaran.',
  },
  antrean: {
    body: 'Papan antrean belum tersambung. Nomor antrean dipanggil langsung oleh petugas.',
  },
  // Layar klinis fase 3: jalur api diisi layar W1–W5 setelah modul API klinisnya tergabung.
  poli: {
    body: 'Antrean poli, tanda vital, CPPT/SOAP, diagnosis ICD-10, dan resume rawat jalan akan tersedia di sini setelah modul rekam medis klinis tersambung ke server SIM RS. Sementara itu, catat pemeriksaan dengan prosedur cadangan rumah sakit.',
  },
  order: {
    body: 'Order laboratorium, radiologi, tindakan, dan resep dengan pemeriksaan keamanan obat (CDS) akan tersedia di sini setelah modul order tersambung ke server SIM RS. Sementara itu, gunakan formulir order dan resep cadangan rumah sakit.',
  },
  igd: {
    body: 'Papan pelacakan IGD dan triase akan tersedia di sini setelah modul IGD tersambung ke server SIM RS. Sementara itu, lakukan triase dengan prosedur cadangan rumah sakit.',
  },
  bed: {
    body: 'Papan tempat tidur, permintaan bed, dan admisi rawat inap akan tersedia di sini setelah modul tempat tidur tersambung ke server SIM RS. Sementara itu, ikuti prosedur admisi cadangan rumah sakit.',
  },
  ranap: {
    body: 'CPPT, eMAR dengan pindai gelang, observasi EWS, dan asuhan keperawatan pasien rawat inap akan tersedia di sini setelah modul rawat inap tersambung ke server SIM RS. Sementara itu, catat asuhan dengan prosedur cadangan rumah sakit.',
  },
  resume: {
    body: 'Resume medis pulang, rekonsiliasi obat, dan TTE DPJP akan tersedia di sini setelah modul resume tersambung ke server SIM RS. Sementara itu, ikuti prosedur resume cadangan rumah sakit.',
  },
  consent: {
    body: 'Persetujuan tindakan di tablet belum tersambung ke server SIM RS. Gunakan formulir persetujuan tindakan kertas sesuai prosedur rumah sakit.',
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
