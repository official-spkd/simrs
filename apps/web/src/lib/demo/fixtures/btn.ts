import type {
  FinancingFacility,
  InstalmentApplication,
  PaymentConfig,
  PaymentTrailStep,
  PaymentTransaction,
  ReceivableBatch,
  ReconRow,
  Refund,
  TrailState,
  WebhookEvent,
} from '@simrs/shared';
import { PATIENT_ID } from './ids';
import { patientById } from './pasien';
import { REKENING } from './rs';
import { PERSONA } from './staf';
import { DEMO_TODAY } from './waktu';

/**
 * Data dummy pembayaran digital TPDI × BTN (I05/U09) dan pembiayaan BTN (U04) (mockup `PembayaranBTN`,
 * `PembiayaanBTN`; ADR-0023). Kamar operasi (S06) di `kamar-operasi.ts`. Semua nominal, nomor VA/QR, referensi, dan
 * rekening fiktif; pasien dari `PASIEN`, staf dari `DOKTER`/`STAF_LAIN`/`PERSONA`. Pasien skenario Ny. Ratna Sari
 * tidak ditulis di sini: ia diproyeksikan dari mesin skenario (`lib/btn-skenario.ts`).
 */

/** Waktu WIB hari demo (atau tanggal lain) sebagai ISO 8601. */
export function wib(hhmm: string, date: string = DEMO_TODAY): string {
  return `${date}T${hhmm.replace('.', ':')}:00+07:00`;
}

export function patientRef(id: string): { id: string; name: string; rm: string } {
  const p = patientById(id);
  if (!p) throw new Error(`Pasien fiktif ${id} tidak ada`);
  return { id: p.id, name: p.nama, rm: p.rm };
}

const step = (label: string, at: string | null, note: string, state: TrailState): PaymentTrailStep => ({
  label,
  at,
  note,
  state,
});

const hook = (
  id: string,
  event: WebhookEvent['event'],
  receivedAt: string,
  amount: string,
  extra: Partial<Pick<WebhookEvent, 'duplicate' | 'response' | 'signatureValid'>> = {},
): WebhookEvent => ({
  id,
  event,
  receivedAt,
  amount,
  signatureValid: extra.signatureValid ?? true,
  duplicate: extra.duplicate ?? false,
  response: extra.response ?? '200 OK · 84 ms',
});

export const BANK_STEP = `Masuk mutasi BTN ${REKENING.operasional}`;

/** Sepuluh transaksi contoh hari demo (dari 199 transaksi digital hari ini). */
export const TRANSAKSI: readonly PaymentTransaction[] = [
  {
    id: 't1',
    invoiceNo: 'INV-2610-02217',
    patient: patientRef(PATIENT_ID.endang),
    channel: 'QRIS',
    amount: '250400',
    status: 'menunggu',
    externalRef: 'TPDI-TX-2610-004431',
    reference: 'QR-2610-88417',
    purpose: 'Selisih naik kelas 1 · sisa setelah deposit',
    createdAt: wib('10.41'),
    expiresAt: wib('10.51'),
    paidAt: null,
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('10.41'), 'QR dinamis via API TPDI · acquirer BTN', 'selesai'),
      step('Menunggu pembayaran', null, 'berlaku s.d. 10.51', 'menunggu'),
      step('Webhook diterima', null, '', 'menunggu'),
      step('Kasir lunas', null, '', 'menunggu'),
      step(BANK_STEP, null, '', 'menunggu'),
    ],
    webhooks: [
      hook('evt-2610-77104', 'invoice.created', wib('10.41'), '250400', { response: '200 OK · 61 ms' }),
    ],
    openInCashier: true,
    scenario: false,
  },
  {
    id: 't2',
    invoiceNo: 'INV-2610-02231',
    patient: patientRef(PATIENT_ID.sutan),
    channel: 'VA',
    amount: '5000000',
    status: 'lunas',
    externalRef: 'TPDI-TX-2610-004402',
    reference: '8808 0127 0223 1001',
    purpose: 'Deposit naik kelas VIP · rawat inap',
    createdAt: wib('08.05'),
    expiresAt: wib('08.05', '2026-10-06'),
    paidAt: wib('09.12'),
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('08.05'), 'VA BTN 8808 0127 0223 1001 diterbitkan via API TPDI', 'selesai'),
      step('Dibayar pasien', wib('09.12'), 'transfer ke VA 8808 0127 0223 1001', 'selesai'),
      step('Webhook diterima · signature valid', wib('09.12'), 'HMAC-SHA256 cocok', 'selesai'),
      step('Callback ganda diabaikan (idempoten)', wib('09.12'), 'event id sama, dibalas 200 OK', 'info'),
      step('Kasir lunas', wib('09.12'), 'kuitansi terbit · jurnal bank otomatis', 'selesai'),
      step(BANK_STEP, wib('09.12'), 'kredit langsung ke rekening operasional', 'selesai'),
    ],
    webhooks: [
      hook('evt-2610-76870', 'payment.paid', wib('09.12'), '5000000'),
      hook('evt-2610-76870', 'payment.paid', '2026-10-05T09:12:51+07:00', '5000000', {
        duplicate: true,
        response: '200 OK · diabaikan (idempoten)',
      }),
    ],
    openInCashier: false,
    scenario: false,
  },
  {
    id: 't3',
    invoiceNo: 'INV-2610-02209',
    patient: patientRef(PATIENT_ID.gilang),
    channel: 'EDC',
    amount: '785000',
    status: 'lunas',
    externalRef: 'EDC-IGD01-0417',
    reference: 'debit · approval 482913',
    purpose: 'IGD umum · fast track (foto toraks dan obat)',
    createdAt: wib('10.36'),
    expiresAt: null,
    paidAt: wib('10.38'),
    account: REKENING.operasional,
    trail: [
      step(
        'Nominal dikirim ke EDC BTN',
        wib('10.36'),
        'terminal kasir IGD-01 · tanpa input nominal manual',
        'selesai',
      ),
      step('Dibayar · approved', wib('10.38'), 'debit · approval 482913', 'selesai'),
      step('Kasir lunas', wib('10.38'), 'kode approval tercatat otomatis · kuitansi terbit', 'selesai'),
      step(BANK_STEP, null, 'menunggu settlement batch EDC', 'menunggu'),
    ],
    webhooks: [],
    openInCashier: false,
    scenario: false,
  },
  {
    id: 't4',
    invoiceNo: 'INV-2610-02198',
    patient: patientRef(PATIENT_ID.fajar),
    channel: 'VA',
    amount: '640000',
    status: 'menunggu',
    externalRef: 'TPDI-TX-2610-004377',
    reference: '8808 0127 0219 8002',
    purpose: 'Uang muka operasi elektif · selisih plafon asuransi',
    createdAt: wib('08.10'),
    expiresAt: wib('08.10', '2026-10-06'),
    paidAt: wib('08.47'),
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('08.10'), 'VA BTN 8808 0127 0219 8002 diterbitkan via API TPDI', 'selesai'),
      step('Dibayar pasien', wib('08.47'), 'tercatat di laporan TPDI dan mutasi BTN', 'selesai'),
      step(
        'Webhook gagal sampai SIM RS',
        wib('08.47'),
        'timeout · retry eksponensial ke-4 terjadwal 12.47',
        'peringatan',
      ),
      step('Kasir lunas', null, 'belum lunas · muncul sebagai pengecualian rekonsiliasi', 'menunggu'),
      step(BANK_STEP, wib('08.47'), 'kredit langsung ke rekening operasional', 'selesai'),
    ],
    webhooks: [
      hook('evt-2610-76511', 'payment.paid', wib('08.47'), '640000', {
        response: 'timeout 10 dtk (retry 3/5)',
      }),
    ],
    openInCashier: true,
    scenario: false,
  },
  {
    id: 't5',
    invoiceNo: 'INV-2610-02225',
    patient: patientRef(PATIENT_ID.sugeng),
    channel: 'QRIS',
    amount: '142500',
    status: 'kedaluwarsa',
    externalRef: 'TPDI-TX-2610-004419',
    reference: 'QR-2610-88390',
    purpose: 'Obat non-Fornas (sitikolin) · farmasi rawat jalan',
    createdAt: wib('09.55'),
    expiresAt: wib('10.05'),
    paidAt: null,
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('09.55'), 'QR dinamis via API TPDI · acquirer BTN', 'selesai'),
      step(
        'Kedaluwarsa',
        wib('10.05'),
        'QR tidak dibayar dalam 10 menit · webhook payment.expired diterima',
        'gagal',
      ),
    ],
    webhooks: [hook('evt-2610-77002', 'payment.expired', wib('10.05'), '142500')],
    openInCashier: false,
    scenario: false,
  },
  {
    id: 't6',
    invoiceNo: 'INV-2610-02236',
    patient: patientRef(PATIENT_ID.raka),
    channel: 'VA',
    amount: '1320000',
    status: 'menunggu',
    externalRef: 'TPDI-TX-2610-004368',
    reference: '8808 0127 0223 6003',
    purpose: 'Deposit naik kelas · rawat inap anak',
    createdAt: wib('08.30'),
    expiresAt: wib('08.30', '2026-10-06'),
    paidAt: null,
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('08.30'), 'VA BTN 8808 0127 0223 6003 diterbitkan via API TPDI', 'selesai'),
      step('Menunggu pembayaran', null, 'berlaku s.d. besok 08.30', 'menunggu'),
      step('Webhook diterima', null, '', 'menunggu'),
      step('Kasir lunas', null, '', 'menunggu'),
      step(BANK_STEP, null, '', 'menunggu'),
    ],
    webhooks: [
      hook('evt-2610-76433', 'invoice.created', wib('08.30'), '1320000', { response: '200 OK · 58 ms' }),
    ],
    openInCashier: true,
    scenario: false,
  },
  {
    id: 't7',
    invoiceNo: 'INV-2610-02212',
    patient: patientRef(PATIENT_ID.bonifasius),
    channel: 'QRIS',
    amount: '96000',
    status: 'lunas',
    externalRef: 'TPDI-TX-2610-004396',
    reference: 'QR-2610-88352',
    purpose: 'Laboratorium atas permintaan sendiri (di luar paket JKN)',
    createdAt: wib('09.29'),
    expiresAt: wib('09.39'),
    paidAt: wib('09.31'),
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('09.29'), 'QR dinamis via API TPDI · acquirer BTN', 'selesai'),
      step('Dibayar pasien', wib('09.31'), 'dipindai dari m-banking / e-wallet', 'selesai'),
      step('Webhook diterima · signature valid', wib('09.31'), 'HMAC-SHA256 cocok', 'selesai'),
      step('Kasir lunas', wib('09.31'), 'kuitansi terbit · jurnal bank otomatis', 'selesai'),
      step(BANK_STEP, wib('09.31'), 'settlement QRIS ke rekening operasional', 'selesai'),
      step('Refund RF-2610-0013 diajukan', wib('09.50'), 'menunggu persetujuan manajer keuangan', 'info'),
    ],
    webhooks: [hook('evt-2610-76902', 'payment.paid', wib('09.31'), '96000')],
    openInCashier: false,
    scenario: false,
  },
  {
    id: 't8',
    invoiceNo: 'INV-2610-02236',
    patient: patientRef(PATIENT_ID.raka),
    channel: 'EDC',
    amount: '1320000',
    status: 'gagal',
    externalRef: 'EDC-RI01-0421',
    reference: 'kredit · response 51',
    purpose: 'Deposit naik kelas · rawat inap anak (kartu kredit)',
    createdAt: wib('08.21'),
    expiresAt: null,
    paidAt: null,
    account: REKENING.operasional,
    trail: [
      step(
        'Nominal dikirim ke EDC BTN',
        wib('08.21'),
        'terminal kasir RI-01 · tanpa input nominal manual',
        'selesai',
      ),
      step(
        'Ditolak issuer',
        wib('08.22'),
        'limit kartu kredit tidak cukup · kasir menerbitkan VA 08.30',
        'gagal',
      ),
      step('Kasir lunas', null, 'tidak terjadi', 'lewati'),
      step(BANK_STEP, null, 'tidak terjadi', 'lewati'),
    ],
    webhooks: [],
    openInCashier: true,
    scenario: false,
  },
  {
    id: 't9',
    invoiceNo: 'INV-2610-02150',
    patient: patientRef(PATIENT_ID.nadia),
    channel: 'VA',
    amount: '3000000',
    status: 'dikembalikan',
    externalRef: 'TPDI-TX-2610-004201',
    reference: '8808 0127 0215 0004',
    purpose: 'Deposit rawat inap anak · batal rawat',
    createdAt: wib('15.40', '2026-10-01'),
    expiresAt: wib('15.40', '2026-10-02'),
    paidAt: wib('16.02', '2026-10-01'),
    account: REKENING.operasional,
    trail: [
      step(
        'Tagihan dibuat',
        wib('15.40', '2026-10-01'),
        'VA BTN 8808 0127 0215 0004 diterbitkan via API TPDI',
        'selesai',
      ),
      step('Dibayar pasien', wib('16.02', '2026-10-01'), 'transfer ke VA 8808 0127 0215 0004', 'selesai'),
      step('Webhook diterima · signature valid', wib('16.02', '2026-10-01'), 'HMAC-SHA256 cocok', 'selesai'),
      step('Kasir lunas', wib('16.02', '2026-10-01'), 'kuitansi terbit · jurnal bank otomatis', 'selesai'),
      step(BANK_STEP, wib('16.02', '2026-10-01'), 'kredit langsung ke rekening operasional', 'selesai'),
      step(
        'Refund RF-2610-0011 selesai',
        wib('14.20', '2026-10-02'),
        'dana kembali ke rekening pembayar ••••5530',
        'info',
      ),
    ],
    webhooks: [
      hook('evt-2610-74120', 'payment.paid', wib('16.02', '2026-10-01'), '3000000'),
      hook('evt-2610-74988', 'refund.completed', wib('14.20', '2026-10-02'), '3000000'),
    ],
    openInCashier: false,
    scenario: false,
  },
  {
    id: 't10',
    invoiceNo: 'INV-2610-02228',
    patient: patientRef(PATIENT_ID.sumarni),
    channel: 'QRIS',
    amount: '2000000',
    status: 'selisih',
    externalRef: 'TPDI-TX-2610-004424',
    reference: 'QR-2610-88402',
    purpose: 'Deposit rawat inap · pasien umum (menunggu bed)',
    createdAt: wib('10.18'),
    expiresAt: wib('10.28'),
    paidAt: wib('10.20'),
    account: REKENING.operasional,
    trail: [
      step('Tagihan dibuat', wib('10.18'), 'QR dinamis via API TPDI · acquirer BTN', 'selesai'),
      step('Dibayar pasien', wib('10.20'), 'dipindai dari m-banking / e-wallet', 'selesai'),
      step(
        'Webhook diterima · signature valid',
        wib('10.20'),
        'nominal Rp 2.000.000 sesuai tagihan',
        'selesai',
      ),
      step(BANK_STEP, wib('10.20'), 'masuk Rp 1.986.000 · selisih Rp 14.000 (MDR terpotong)', 'peringatan'),
      step(
        'Kasir lunas',
        null,
        'ditahan: selisih nominal → pengecualian rekonsiliasi, bukan lunas otomatis',
        'menunggu',
      ),
    ],
    webhooks: [hook('evt-2610-77051', 'payment.paid', wib('10.20'), '2000000')],
    openInCashier: false,
    scenario: false,
  },
];

const src = (amount: string | null, note = '') => ({ amount, note });

/** Rekonsiliasi 3 arah hari ini: tiga baris cocok/menunggu dan tiga pengecualian yang wajib dijelaskan. */
export const REKONSILIASI: readonly ReconRow[] = [
  {
    id: 'r1',
    label: patientRef(PATIENT_ID.sutan).name,
    source: 'VA BTN · INV-2610-02231',
    transactionId: 't2',
    kasir: src('5000000'),
    tpdi: src('5000000', '2 callback'),
    bank: src('5000000'),
    status: 'cocok',
    note: 'callback ganda diabaikan',
    exception: null,
    scenario: false,
  },
  {
    id: 'r2',
    label: patientRef(PATIENT_ID.bonifasius).name,
    source: 'QRIS · INV-2610-02212',
    transactionId: 't7',
    kasir: src('96000'),
    tpdi: src('96000'),
    bank: src('96000'),
    status: 'cocok',
    note: '',
    exception: null,
    scenario: false,
  },
  {
    id: 'r3',
    label: patientRef(PATIENT_ID.gilang).name,
    source: 'EDC BTN · INV-2610-02209',
    transactionId: 't3',
    kasir: src('785000'),
    tpdi: src(null, 'EDC langsung BTN'),
    bank: src(null, 'belum masuk'),
    status: 'menunggu-settlement',
    note: 'settlement batch EDC',
    exception: null,
    scenario: false,
  },
  {
    id: 'x1',
    label: patientRef(PATIENT_ID.fajar).name,
    source: 'VA BTN · INV-2610-02198',
    transactionId: 't4',
    kasir: src(null, 'belum lunas'),
    tpdi: src('640000'),
    bank: src('640000'),
    status: 'pengecualian',
    note: 'perlu tindakan',
    exception: {
      kind: 'webhook-gagal',
      adjustment: '640000',
      explanation:
        'Dana sudah masuk BTN dan tercatat di laporan TPDI, tetapi webhook gagal sampai ke SIM RS sehingga tagihan belum lunas di kasir.',
      actions: [
        { id: 'lunas', label: 'Tandai lunas di kasir (TPDI + BTN cocok)' },
        { id: 'ulang', label: 'Minta TPDI kirim ulang webhook' },
      ],
      resolution: null,
    },
    scenario: false,
  },
  {
    id: 'x2',
    label: patientRef(PATIENT_ID.sumarni).name,
    source: 'QRIS · INV-2610-02228',
    transactionId: 't10',
    kasir: src('2000000', 'ditahan'),
    tpdi: src('2000000'),
    bank: src('1986000', 'MDR terpotong'),
    status: 'pengecualian',
    note: 'perlu tindakan',
    exception: {
      kind: 'nominal-beda',
      adjustment: '-14000',
      explanation:
        'Mutasi BTN Rp 14.000 lebih kecil dari laporan TPDI: MDR QRIS 0,7% (simulasi) terpotong saat settlement.',
      actions: [
        { id: 'mdr', label: 'Catat Rp 14.000 sebagai beban MDR QRIS' },
        { id: 'koreksi', label: 'Ajukan koreksi ke BTN (MDR ditagih terpisah)' },
      ],
      resolution: null,
    },
    scenario: false,
  },
  {
    id: 'x3',
    label: 'Tanpa referensi',
    source: 'transfer masuk · berita "SUGENG 02225"',
    transactionId: null,
    kasir: src(null),
    tpdi: src(null),
    bank: src('142500'),
    status: 'pengecualian',
    note: 'perlu tindakan',
    exception: {
      kind: 'hanya-di-bank',
      adjustment: '142500',
      explanation:
        'Transfer masuk tanpa nomor VA, berita "SUGENG 02225". QR tagihan INV-2610-02225 kedaluwarsa pukul 10.05.',
      actions: [
        { id: 'padan', label: 'Padankan ke Tn. Sugeng Riyadi · INV-2610-02225' },
        { id: 'titip', label: 'Catat sebagai titipan tak teridentifikasi' },
        { id: 'kembali', label: 'Kembalikan ke pengirim lewat refund' },
      ],
      resolution: null,
    },
    scenario: false,
  },
];

const KASIR_LOKET = `${PERSONA.kasir} (kasir RI-01)`;
const MANAJER_KEUANGAN = PERSONA.akuntan;

export const REFUND: readonly Refund[] = [
  {
    id: 'rf14',
    number: 'RF-2610-0014',
    patient: patientRef(PATIENT_ID.sutan),
    channel: 'VA',
    transactionRef: 'TPDI-TX-2610-004402 · INV-2610-02231',
    amount: '1150000',
    maxAmount: '1150000',
    destination: 'rekening asal pembayar ••••2290 a.n. Sutan Batubara',
    context:
      'Deposit VA Rp 5.000.000 untuk naik kelas VIP; estimasi selisih kelas VIP − kelas 1 Rp 3.850.000, kelebihan dikembalikan tanpa menunggu pulang.',
    stage: 'draf',
    reason: null,
    reasonNote: '',
    log: [{ at: wib('10.36'), text: `Draf dibuat dari kasir loket RI-01 · ${PERSONA.kasir}` }],
  },
  {
    id: 'rf13',
    number: 'RF-2610-0013',
    patient: patientRef(PATIENT_ID.bonifasius),
    channel: 'QRIS',
    transactionRef: 'TPDI-TX-2610-004396 · INV-2610-02212',
    amount: '96000',
    maxAmount: null,
    destination: 'rekening sumber QRIS ••••8812 a.n. Bonifasius Tarigan',
    context: 'Pembayaran QRIS Rp 96.000 untuk pemeriksaan laboratorium yang kemudian dibatalkan.',
    stage: 'menunggu-manajer',
    reason: 'layanan-dibatalkan',
    reasonNote: 'Pemeriksaan lab dibatalkan DPJP setelah pasien membayar; sampel belum diambil.',
    log: [
      { at: wib('09.50'), text: `Diajukan · ${KASIR_LOKET}` },
      { at: wib('10.02'), text: 'Disetujui supervisor kasir (tingkat 1)' },
    ],
  },
  {
    id: 'rf11',
    number: 'RF-2610-0011',
    patient: patientRef(PATIENT_ID.nadia),
    channel: 'VA',
    transactionRef: 'TPDI-TX-2610-004201 · INV-2610-02150',
    amount: '3000000',
    maxAmount: null,
    destination: 'rekening asal pembayar ••••5530 a.n. orang tua pasien',
    context: 'Deposit rawat inap Rp 3.000.000; pasien batal dirawat setelah observasi.',
    stage: 'dana-kembali',
    reason: 'batal-rawat-inap',
    reasonNote: 'Pasien batal rawat inap; deposit dikembalikan penuh sesuai kebijakan RS.',
    log: [
      { at: wib('09.15', '2026-10-02'), text: `Diajukan · ${KASIR_LOKET}` },
      { at: wib('09.40', '2026-10-02'), text: 'Disetujui supervisor kasir (tingkat 1)' },
      { at: wib('11.05', '2026-10-02'), text: `Disetujui manajer keuangan · ${MANAJER_KEUANGAN}` },
      {
        at: wib('11.06', '2026-10-02'),
        text: `Instruksi transfer dikirim via TPDI → BTN, debit ${REKENING.operasional}`,
      },
      { at: wib('14.20', '2026-10-02'), text: 'Dana diterima rekening pasien · ref BTN TRF-0210-7741' },
    ],
  },
];

export const KONFIGURASI: PaymentConfig = {
  merchantId: 'TPDI-RS-00127',
  operationalAccount: REKENING.operasional,
  claimAccount: REKENING.penampungan,
  channels: [
    {
      id: 'va',
      name: 'Virtual Account BTN',
      sub: 'via TPDI · nomor 8808 0127 …',
      fee: 'Rp 4.000/transaksi · dikenakan BTN',
      enabled: true,
      expiry: {
        value: '24',
        options: [
          { value: '12', label: '12 jam' },
          { value: '24', label: '24 jam' },
          { value: '48', label: '48 jam' },
        ],
      },
    },
    {
      id: 'qris',
      name: 'QRIS dinamis',
      sub: 'via TPDI · acquirer BTN',
      fee: 'MDR 0,7% · dikenakan BTN',
      enabled: true,
      expiry: {
        value: '10',
        options: [
          { value: '5', label: '5 menit' },
          { value: '10', label: '10 menit' },
          { value: '15', label: '15 menit' },
        ],
      },
    },
    {
      id: 'edc',
      name: 'EDC BTN (debit/kredit)',
      sub: 'terintegrasi kasir · tanpa TPDI',
      fee: 'debit 0,15% · kredit 1,8% · dikenakan BTN',
      enabled: true,
      expiry: null,
    },
    {
      id: 'cicilan',
      name: 'Cicilan BTN',
      sub: 'Pembiayaan kesehatan BTN (simulasi) · dari kasir',
      fee: 'tanpa biaya ke RS · angsuran dibayar pasien ke BTN',
      enabled: true,
      expiry: null,
    },
  ],
  mode: 'produksi',
  webhook: {
    url: 'POST /api/v1/webhooks/tpdi/RSFA',
    algorithm: 'HMAC-SHA256',
    signatureHeader: 'X-TPDI-Signature',
    eventIdHeader: 'X-TPDI-Event-Id',
    toleranceSec: 300,
    retry: 'eksponensial 5× (1 mnt → 6 jam) bila SIM RS tidak membalas 2xx',
    secretMasked: 'whsec_••••3f9a',
    secretRotatedOn: '2026-09-12',
  },
};

/** Ringkasan harian seluruh transaksi digital (daftar hanya memuat contoh). */
export const HARIAN = {
  recorded: '48620000',
  successful: { va: 64, qris: 98, edc: 25 },
  pending: 12,
  edcUnsettled: '785000',
} as const;

export const KONEKSI = {
  lastWebhookAt: wib('10.41'),
  latencyP95Ms: 210,
  lastBankPullAt: wib('10.40'),
  pullEveryMin: 5,
} as const;

export const REKON_JADWAL = { lastAutoRunAt: wib('10.30'), nextAutoRunAt: wib('11.00') } as const;

// ---------------------------------------------------------------- U04 · pembiayaan BTN

export const FASILITAS: FinancingFacility = {
  agreementNo: '0127/PKS-PB/BTN-RS/VIII/2026',
  validFrom: '2026-09-01',
  validTo: '2027-08-31',
  limit: '15000000000',
  advanceRatePercent: 90,
  marginBps: 800,
  maxTenorDays: 90,
  avgBpjsPayDays: 34,
  operationalAccount: REKENING.operasional,
  claimAccount: REKENING.penampungan,
};

const batch = (
  id: string,
  period: string,
  kind: string,
  files: number,
  amount: string,
  status: ReceivableBatch['status'],
  note: string,
  drawdownId: string | null = null,
): ReceivableBatch => ({ id, period, kind, files, amount, status, note, drawdownId });

/** Pool klaim BPJS per batch bulan pelayanan (nilai fiktif). */
export const POOL_KLAIM: readonly ReceivableBatch[] = [
  batch('p1', 'Jul 2026', 'RJ + RI', 3214, '4800000000', 'layak', 'BA verifikasi 26 Agu', 'PCR-2609-01'),
  batch('p2', 'Agu 2026', 'RI tahap 1', 402, '3500000000', 'layak', 'BA verifikasi 15 Sep', 'PCR-2609-02'),
  batch('p3', 'Agu 2026', 'Rawat jalan', 1842, '2140000000', 'layak', 'BA verifikasi 24 Sep'),
  batch('p4', 'Agu 2026', 'RI tahap 2', 210, '1960000000', 'layak', 'BA verifikasi 28 Sep'),
  batch('p5', 'Sep 2026', 'Rawat jalan', 1910, '2480000000', 'layak', 'BA verifikasi 2 Okt'),
  batch('p6', 'Sep 2026', 'RI tahap 1', 388, '3120000000', 'layak', 'BA verifikasi 2 Okt'),
  batch('p7', 'Sep 2026', 'RI tahap 2', 486, '2940000000', 'pending', 'menunggu BA verifikasi BPJS'),
  batch('p8', 'Sep 2026', 'RJ susulan', 96, '118000000', 'pending', 'berkas perbaikan dikirim ulang'),
  batch('p9', 'Agu 2026', 'RI dispute', 14, '12400000', 'dispute', 'dispute verifikator · lihat Klaim'),
];

/** Pencairan berjalan (pokok = advance 90% batch dasar). */
export const PENCAIRAN = [
  {
    id: 'PCR-2609-01',
    batchIds: ['p1'],
    principal: '4320000000',
    stage: 'cair',
    disbursedOn: '2026-09-04',
    dueOn: '2026-12-03',
    settledOn: null,
    marginPaid: null,
  },
  {
    id: 'PCR-2609-02',
    batchIds: ['p2'],
    principal: '3150000000',
    stage: 'cair',
    disbursedOn: '2026-09-22',
    dueOn: '2026-12-21',
    settledOn: null,
    marginPaid: null,
  },
] as const;

type HistoryEntry = InstalmentApplication['history'][number];
const hist = (...items: Array<[HistoryEntry['stage'], string, string]>): HistoryEntry[] =>
  items.map(([stage, hhmm, date]) => ({ stage, at: wib(hhmm, date) }));

const app = (
  a: Omit<InstalmentApplication, 'patient' | 'scenario' | 'rejectReason'> & {
    patientId: string;
    rejectReason?: string;
  },
): InstalmentApplication => {
  const { patientId, rejectReason, ...rest } = a;
  return { ...rest, patient: patientRef(patientId), rejectReason: rejectReason ?? null, scenario: false };
};

/** Tujuh pengajuan cicilan biaya pasien (produk dan keputusan milik BTN; data fiktif). */
export const CICILAN: readonly InstalmentApplication[] = [
  app({
    id: 'a1',
    reference: 'PB-2610-0084',
    patientId: PATIENT_ID.fajar,
    service: 'Selisih plafon asuransi · laparoskopi kolesistektomi',
    invoiceNo: 'INV-2610-02244',
    amount: '8600000',
    tenorMonths: 12,
    source: 'Aplikasi pasien',
    applicant: 'Pemohon: pasien sendiri',
    note: 'Estimasi selisih plafon asuransi diajukan sebelum operasi; nilai final mengikuti tagihan.',
    stage: 'verifikasi',
    history: hist(['diajukan', '19.22', '2026-10-02'], ['verifikasi', '08.05', '2026-10-03']),
  }),
  app({
    id: 'a2',
    reference: 'PB-2610-0087',
    patientId: PATIENT_ID.wulan,
    service: 'Selisih naik kelas VIP · persalinan sesar',
    invoiceNo: 'INV-2610-02251',
    amount: '14200000',
    tenorMonths: 12,
    source: 'Aplikasi pasien',
    applicant: 'Pemohon: pasien sendiri',
    note: '',
    stage: 'diajukan',
    history: hist(['diajukan', '09.47', DEMO_TODAY]),
  }),
  app({
    id: 'a3',
    reference: 'PB-2610-0079',
    patientId: PATIENT_ID.joko,
    service: 'Selisih naik kelas VIP · ORIF femur (rawat 8–14 Sep)',
    invoiceNo: 'INV-2609-01962',
    amount: '22300000',
    tenorMonths: 18,
    source: 'Kasir',
    applicant: 'Pemohon: pasien sendiri',
    note: '',
    stage: 'akad',
    history: hist(
      ['diajukan', '10.15', '2026-10-01'],
      ['verifikasi', '10.16', '2026-10-01'],
      ['disetujui', '14.30', '2026-10-02'],
      ['akad', '08.52', '2026-10-03'],
    ),
  }),
  app({
    id: 'a4',
    reference: 'PB-2609-0071',
    patientId: PATIENT_ID.maria,
    service: 'Selisih naik kelas VIP · rawat inap kemoterapi siklus 2 (Agu)',
    invoiceNo: 'INV-2608-01790',
    amount: '11900000',
    tenorMonths: 12,
    source: 'Aplikasi pasien',
    applicant: 'Pemohon: pasien sendiri',
    note: '',
    stage: 'disetujui',
    history: hist(
      ['diajukan', '11.02', '2026-09-30'],
      ['verifikasi', '11.03', '2026-09-30'],
      ['disetujui', '16.20', '2026-10-01'],
    ),
  }),
  app({
    id: 'a5',
    reference: 'PB-2610-0075',
    patientId: PATIENT_ID.yusuf,
    service: 'Selisih naik kelas VIP · rawat inap Sep',
    invoiceNo: 'INV-2609-01942',
    amount: '6750000',
    tenorMonths: 6,
    source: 'Kasir',
    applicant: 'Pemohon: anak pasien (wali)',
    note: '',
    stage: 'dicairkan',
    history: hist(
      ['diajukan', '08.10', '2026-10-01'],
      ['verifikasi', '08.11', '2026-10-01'],
      ['disetujui', '13.45', '2026-10-01'],
      ['akad', '15.02', '2026-10-01'],
      ['dicairkan', '09.30', '2026-10-02'],
    ),
  }),
  app({
    id: 'a6',
    reference: 'PB-2609-0068',
    patientId: PATIENT_ID.lestiani,
    service: 'Selisih naik kelas VIP · rawat inap stroke (Sep)',
    invoiceNo: 'INV-2609-01988',
    amount: '11900000',
    tenorMonths: 12,
    source: 'Aplikasi pasien',
    applicant: 'Pemohon: pasien sendiri',
    note: '',
    stage: 'dicairkan',
    history: hist(
      ['diajukan', '14.20', '2026-09-29'],
      ['verifikasi', '14.21', '2026-09-29'],
      ['disetujui', '10.05', '2026-09-30'],
      ['akad', '11.40', '2026-09-30'],
      ['dicairkan', '09.15', '2026-10-01'],
    ),
  }),
  app({
    id: 'a7',
    reference: 'PB-2610-0077',
    patientId: PATIENT_ID.ayu,
    service: 'Tindakan rawat jalan · pasien umum',
    invoiceNo: 'INV-2610-02133',
    amount: '4800000',
    tenorMonths: 3,
    source: 'Kasir',
    applicant: 'Pemohon: pasien sendiri',
    note: '',
    stage: 'ditolak',
    rejectReason: 'Data penghasilan tidak dapat diverifikasi BTN',
    history: hist(
      ['diajukan', '16.40', '2026-10-01'],
      ['verifikasi', '16.41', '2026-10-01'],
      ['ditolak', '11.05', '2026-10-02'],
    ),
  }),
];
