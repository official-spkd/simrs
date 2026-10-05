import type {
  AntreanAddRequest,
  AplicareBedRequest,
  VclaimPeserta,
  VclaimRujukanKeluarTRujukan,
  VclaimSepInsertTSep,
} from '@simrs/shared';
import { MOCK_DOKTER, MOCK_HFIS_TEMPLAT, type MockSesi } from './master';

/** Keadaan mock BPJS di memori (hilang saat restart; E2E mereset lewat `POST /_panel/api/reset`). */

export interface AntreanTaskRecord {
  taskid: number;
  /** Waktu task dari RS (milidetik epoch). */
  waktu: number;
  /** Waktu diterima mock (milidetik epoch). */
  diterima: number;
  jenisresep?: string;
}

export interface AntreanRecord {
  kodebooking: string;
  request: AntreanAddRequest;
  status: 'aktif' | 'batal';
  dibuat: string;
  /** Urut sesuai diterima. */
  tasks: AntreanTaskRecord[];
  batal: { keterangan: string; at: string; lewat: 'batal' | 'task99' } | null;
}

export interface SepRecord {
  noSep: string;
  status: 'terbit' | 'dihapus';
  /** Isi `t_sep` terakhir (insert + perubahan lewat update). */
  tSep: VclaimSepInsertTSep;
  /** Potret peserta saat SEP terbit. */
  peserta: VclaimPeserta;
  versi: number;
  dibuat: string;
  diubah: string | null;
  dihapus: string | null;
  /** Rawat inap: diisi lewat `updtglplg`. */
  pulang: { tglPulang: string; statusPulang: string; noSuratMeninggal: string; tglMeninggal: string } | null;
}

export interface SuratRecord {
  noSurat: string;
  jenis: 'kontrol' | 'spri';
  status: 'aktif' | 'dihapus';
  diubah: string | null;
  noKartu: string;
  noSepAsal: string | null;
  kodeDokter: string;
  poliKontrol: string;
  tglRencanaKontrol: string;
  tglTerbit: string;
  diagnosa: string | null;
}

/** F07 · Rujukan keluar yang diterbitkan RS ini dari SEP-nya. */
export interface RujukanKeluarRecord {
  noRujukan: string;
  status: 'terbit' | 'dihapus';
  /** Isi `t_rujukan` terakhir (insert + perubahan). */
  tRujukan: VclaimRujukanKeluarTRujukan;
  /** PPK asal = PPK pelayanan SEP. */
  ppkAsal: string;
  peserta: VclaimPeserta;
  noMR: string;
  dibuat: string;
  diubah: string | null;
  dihapus: string | null;
}

/** Ruang Aplicare terdaftar milik satu PPK. */
export interface AplicareRuangRecord extends AplicareBedRequest {
  /** `YYYY-MM-DD HH:mm:ss` WIB. */
  lastupdate: string;
}

/** Perubahan per tanggal yang dicatat petugas di aplikasi HFIS (panel), berlaku untuk semua sesi dokter itu. */
export interface HfisOverride {
  kodedokter: number;
  tanggal: string;
  libur?: boolean;
  kapasitaspasien?: number;
}

/** Peserta yang ditetapkan lewat panel (mis. agar cocok dengan pasien seed di E2E). */
export interface PesertaOverride {
  noKartu: string;
  nik: string;
  nama?: string;
  sex?: 'L' | 'P';
  tglLahir?: string;
  aktif?: boolean;
  hakKelas?: '1' | '2' | '3';
}

export const hfisKey = (kodepoli: string, kodedokter: number) => `${kodepoli}:${kodedokter}`;

function initialTemplat(): Map<string, MockSesi[]> {
  const m = new Map<string, MockSesi[]>();
  for (const d of MOCK_DOKTER) m.set(hfisKey(d.kodepoli, d.kode), [...(MOCK_HFIS_TEMPLAT.get(d.kode) ?? [])]);
  return m;
}

export class BpjsState {
  antrean = new Map<string, AntreanRecord>();
  seps = new Map<string, SepRecord>();
  surat = new Map<string, SuratRecord>();
  rujukanKeluar = new Map<string, RujukanKeluarRecord>();
  /** Aplicare per kode PPK → ruang per `<kodekelas>|<koderuang>` (urut didaftarkan). */
  aplicare = new Map<string, Map<string, AplicareRuangRecord>>();
  /** `<noKartu>|<tanggal>` yang sudah rekam sidik jari. */
  fingerprints = new Set<string>();
  /** Templat mingguan HFIS per `<kodepoli>:<kodedokter>`. */
  hfisTemplat = initialTemplat();
  hfisOverride = new Map<string, HfisOverride>();
  /** Riwayat `updatejadwaldokter` (terbaru di depan). */
  hfisUpdates: Array<{ at: string; kodepoli: string; kodedokter: number; jadwal: string[] }> = [];
  nikByKartu = new Map<string, string>();
  kartuByNik = new Map<string, string>();
  pesertaOverride = new Map<string, PesertaOverride>();
  private sepSeq = 0;
  private suratSeq = 0;
  private rujukanSeq = 0;

  reset(): void {
    this.antrean.clear();
    this.seps.clear();
    this.surat.clear();
    this.rujukanKeluar.clear();
    this.aplicare.clear();
    this.rujukanSeq = 0;
    this.fingerprints.clear();
    this.hfisTemplat = initialTemplat();
    this.hfisOverride.clear();
    this.hfisUpdates = [];
    this.nikByKartu.clear();
    this.kartuByNik.clear();
    this.pesertaOverride.clear();
    this.sepSeq = 0;
    this.suratSeq = 0;
  }

  nextSepSeq(): number {
    this.sepSeq += 1;
    return this.sepSeq;
  }

  nextRujukanSeq(): number {
    this.rujukanSeq += 1;
    return this.rujukanSeq;
  }

  nextSuratSeq(): number {
    this.suratSeq += 1;
    return this.suratSeq;
  }
}
