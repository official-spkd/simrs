import { type EventCapture, line, reversal } from '../../keuangan-charge';
import { pasienRef } from './keuangan-ref';
import { PERSONA } from './staf';

/**
 * U02 · Data dummy charge capture monitor (mode presentasi, ADR-0023): event klinis hari presentasi (5 Okt 2026)
 * dari ADT, CPPT, CPOE, eMAR, LIS, RIS, farmasi, dan kamar operasi. Harga satuan = tarif berlaku (layar Tarif) pada
 * kelas pasien dan penjamin saat layanan (dijaga tes). Pasien fiktif sama dengan roster rawat inap.
 */

const at = (hm: string) => `2026-10-05T${hm.replace('.', ':')}:00+07:00`;

const P = {
  endang: pasienRef('endang', 'Melati M-203 · Kelas 2', 'BPJS kelas 2'),
  yusuf: pasienRef('yusuf', 'Anggrek A-15 · Kelas 1', 'BPJS kelas 1'),
  sutan: pasienRef('sutan', 'VIP 2 · naik kelas VIP', 'BPJS kelas 1'),
  aminah: pasienRef('aminah', 'ICU 7 · Kelas 3', 'BPJS kelas 3'),
  raka: pasienRef('raka', 'Wijaya Kusuma W-308 · titipan', 'BPJS kelas 2'),
  fajar: pasienRef('fajar', 'OK 2 → Anggrek · Kelas 1', 'Asuransi swasta'),
  fransiska: pasienRef('fransiska', 'Anggrek A-09 · Kelas 1', 'Asuransi swasta'),
};

const hba1c = line('LAB-HBA', 'HbA1c', 1, 185_000n);
const azitro = line('OBT-AZI', 'Azitromisin 500 mg (retur 2 tablet)', 2, 32_000n);
const kursiRoda = line('MNL-KRD', 'Sewa kursi roda', 1, 25_000n);

/** Event klinis hari ini yang tampil di monitor (contoh; total hari ini di `CAPTURE_EVENT_TOTAL`). */
export const CAPTURE_EVENTS: readonly EventCapture[] = [
  {
    id: 'cc-01',
    at: at('06.00'),
    source: 'adt',
    event: 'bed.occupied',
    description: 'Akomodasi harian (sensus 06.00)',
    patient: P.yusuf,
    status: 'tertagih',
    line: line('AKM-KMR', 'Akomodasi kamar Kelas 1', 1, 750_000n),
  },
  {
    id: 'cc-02',
    at: at('06.00'),
    source: 'adt',
    event: 'bed.occupied',
    description: 'Akomodasi harian (sensus 06.00)',
    patient: P.sutan,
    status: 'tertagih',
    line: line('AKM-KMR', 'Akomodasi kamar VIP', 1, 1_800_000n),
  },
  {
    id: 'cc-03',
    at: at('07.42'),
    source: 'cppt',
    event: 'visit.recorded',
    description: 'Visite DPJP Sp.PD tercatat di CPPT',
    patient: P.endang,
    status: 'tertagih',
    line: line('VST-SP', 'Visite dokter spesialis Kelas 2', 1, 180_000n),
  },
  {
    id: 'cc-04',
    at: at('07.55'),
    source: 'emar',
    event: 'medication.administered',
    description: 'Nebulisasi (stok ruangan) dipindai gelang',
    patient: P.endang,
    status: 'tertagih',
    line: line('TND-NEB', 'Nebulisasi Kelas 2', 1, 35_000n),
  },
  {
    id: 'cc-05',
    at: at('07.58'),
    source: 'lis',
    event: 'lab.specimen_received',
    description: 'Sampel HbA1c diterima laboratorium',
    patient: P.yusuf,
    status: 'dibalik',
    line: hba1c,
  },
  {
    id: 'cc-06',
    at: at('08.10'),
    source: 'lis',
    event: 'lab.specimen_received',
    description: 'Sampel darah lengkap diterima laboratorium',
    patient: P.yusuf,
    status: 'tertagih',
    line: line('LAB-DL', 'Darah lengkap', 1, 95_000n),
  },
  {
    id: 'cc-07',
    at: at('08.12'),
    source: 'lis',
    event: 'lab.specimen_received',
    description: 'Sampel ureum dan kreatinin diterima laboratorium',
    patient: P.aminah,
    status: 'tertagih',
    line: line('LAB-UK', 'Ureum dan kreatinin', 1, 110_000n),
  },
  {
    id: 'cc-08',
    at: at('08.25'),
    source: 'cpoe',
    event: 'order.cancelled',
    description: 'Order HbA1c dibatalkan DPJP (duplikat order 3 hari lalu) · baris pembalik otomatis',
    patient: P.yusuf,
    status: 'dibalik',
    line: reversal(hba1c),
    reverses: 'cc-05',
  },
  {
    id: 'cc-09',
    at: at('08.40'),
    source: 'ris',
    event: 'radiology.exam_completed',
    description: 'Foto toraks PA evaluasi selesai',
    patient: P.endang,
    status: 'tertagih',
    line: line('RAD-TPA', 'Foto toraks PA', 1, 240_000n),
  },
  {
    id: 'cc-10',
    at: at('09.05'),
    source: 'farmasi',
    event: 'pharmacy.dispensed',
    description: 'Seftriakson 1 g injeksi diserahkan ke ruangan',
    patient: P.yusuf,
    status: 'tertagih',
    line: line('OBT-SEF', 'Seftriakson 1 g injeksi', 2, 85_000n),
  },
  {
    id: 'cc-11',
    at: at('09.20'),
    source: 'adt',
    event: 'bed.transferred',
    description: 'Pindah ke W-308 sebagai titipan; kelas rawat belum ditetapkan admisi',
    patient: P.raka,
    status: 'tertahan',
    line: null,
    hold: {
      kind: 'kelas-belum-ada',
      reason: 'Kelas rawat belum ditetapkan (titipan bangsal penuh); akomodasi tidak bisa diberi harga.',
      resolution: line('AKM-KMR', 'Akomodasi kamar Kelas 2', 1, 450_000n),
    },
  },
  {
    id: 'cc-12',
    at: at('09.45'),
    source: 'cppt',
    event: 'visit.recorded',
    description: 'Visite dokter subspesialis Sp.PD-KGH tercatat di CPPT',
    patient: P.sutan,
    status: 'tertahan',
    line: null,
    hold: {
      kind: 'tarif-tidak-ada',
      reason: 'Tarif visite subspesialis untuk kelas VIP belum ada di master tarif.',
      resolution: line('VST-SUB', 'Visite dokter subspesialis VIP', 1, 400_000n),
      tariffApprovedAt: at('10.05'),
    },
  },
  {
    id: 'cc-13',
    at: at('09.50'),
    source: 'ok',
    event: 'surgery.case_completed',
    description: 'Kolesistektomi laparoskopik selesai · paket PKT-OK-051 (Kelas 1)',
    patient: P.fajar,
    status: 'tertagih',
    line: line('PKT-OK-051', 'Paket kolesistektomi laparoskopik Kelas 1', 1, 13_600_000n),
  },
  {
    id: 'cc-14',
    at: at('10.02'),
    source: 'lis',
    event: 'lab.specimen_received',
    description: 'Sampel prokalsitonin diterima laboratorium',
    patient: P.aminah,
    status: 'tertahan',
    line: null,
    hold: {
      kind: 'tarif-tidak-ada',
      reason: 'Pemeriksaan prokalsitonin baru diaktifkan di LIS; belum ada tarif.',
      resolution: line('LAB-PCT', 'Prokalsitonin', 1, 420_000n),
    },
  },
  {
    id: 'cc-15',
    at: at('10.10'),
    source: 'pendaftaran',
    event: 'coverage.changed',
    description: 'Penjamin berubah Umum → Asuransi swasta (surat jaminan diterima)',
    patient: P.fransiska,
    status: 'tertahan',
    line: null,
    hold: {
      kind: 'penjamin-berubah',
      reason:
        '3 baris terbuka masih bertarif umum; harus dibalik dan dibuat ulang dengan tarif kontrak asuransi.',
      resolution: null,
      reprice: [
        {
          before: line('AKM-KMR', 'Akomodasi kamar Kelas 1', 1, 750_000n),
          after: line('AKM-KMR', 'Akomodasi kamar Kelas 1 · tarif asuransi', 1, 825_000n),
        },
        {
          before: line('VST-SP', 'Visite dokter spesialis Kelas 1', 1, 220_000n),
          after: line('VST-SP', 'Visite dokter spesialis Kelas 1 · tarif asuransi', 1, 242_000n),
        },
        {
          before: line('TND-KAT', 'Pemasangan kateter urin Kelas 1', 1, 80_000n),
          after: line('TND-KAT', 'Pemasangan kateter urin Kelas 1 · tarif asuransi', 1, 88_000n),
        },
      ],
    },
  },
  {
    id: 'cc-16',
    at: at('10.20'),
    source: 'kasir',
    event: 'charge.manual_added',
    description: 'Item manual kasir (alasan tercatat)',
    patient: P.endang,
    status: 'tertagih',
    line: kursiRoda,
    manual: { by: PERSONA.kasir, reason: 'Dipakai saat ke radiologi; belum ada event dari ruangan' },
  },
  {
    id: 'cc-17',
    at: at('10.31'),
    source: 'farmasi',
    event: 'pharmacy.returned',
    description: 'Retur obat dari ruangan: azitromisin 2 tablet · baris pembalik otomatis',
    patient: P.endang,
    status: 'dibalik',
    line: reversal(azitro),
  },
];

/** Jumlah event klinis bisa-tagih hari ini di seluruh RS (monitor menampilkan contoh terbaru). */
export const CAPTURE_EVENT_TOTAL = 1_842;
