'use client';

import { formatJam } from '@simrs/shared';
import {
  Alert,
  Button,
  Card,
  Chip,
  cx,
  DOMAINS,
  type DomainKey,
  Field,
  FilterChip,
  Icon,
  KpiCard,
  PatientBanner,
  RadioSegmented,
  RAMP_STEPS,
  type RampName,
  ramps,
  StatusChip,
  Tabs,
  triageLevels,
} from '@simrs/ui';
import { type ReactNode, useState } from 'react';

/** Bagian bernomor galeri (papan F1–F5): judul 20 px di atas isi. */
function Section({
  id,
  title,
  lead,
  children,
  className,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cx('flex flex-col gap-4', className)}>
      <span className="flex flex-col gap-1">
        <h2 id={id} className="m-0 text-[20px] font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        {lead && <span className="max-w-[760px] text-small text-ink-500">{lead}</span>}
      </span>
      {children}
    </section>
  );
}

/** Kartu satu komponen: judul tebal, contoh interaktif, catatan pemakaian di bawah. */
function Demo({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cx('flex min-w-0 flex-col gap-3.5 p-5', className)}>
      <span className="font-semibold">{title}</span>
      {children}
      {note && <span className="text-small text-ink-500">{note}</span>}
    </Card>
  );
}

/** Rasio kontras WCAG antara dua warna hex (#RRGGBB). */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ratioText = (n: number) => `${n.toFixed(1).replace('.', ',')}:1`;

const INK = ramps.batu[9];
const WHITE = '#FFFFFF';

/** Urutan dan peran rona (papan F1). Kunyit dan koral khusus status. */
const RAMP_ROLES: ReadonlyArray<{ ramp: RampName; label: string; role: string }> = [
  { ramp: 'samudra', label: 'Samudra', role: 'Aksi utama · front office · info' },
  { ramp: 'zamrud', label: 'Zamrud', role: 'Klinis · sukses' },
  { ramp: 'anggrek', label: 'Anggrek', role: 'Penunjang (lab, radiologi, farmasi, OK)' },
  { ramp: 'toska', label: 'Toska', role: 'Keuangan dan pembayaran' },
  { ramp: 'bougenvil', label: 'Bougenvil', role: 'Manajemen dan back office' },
  { ramp: 'batu', label: 'Batu', role: 'Netral · teks, garis, permukaan · sistem' },
  { ramp: 'kunyit', label: 'Kunyit', role: 'Peringatan (khusus status)' },
  { ramp: 'koral', label: 'Koral', role: 'Kritis dan bahaya (khusus status)' },
];

/** Warna status: latar 100 + teks 700/800 rona yang sama. Tidak ikut domain. */
const STATUS_COLORS: ReadonlyArray<{
  name: string;
  use: string;
  ramp: RampName;
  text: number;
  symbol: string;
}> = [
  { name: 'Sukses', use: 'Tersimpan, terverifikasi, lolos CDS', ramp: 'zamrud', text: 7, symbol: '✓' },
  { name: 'Info', use: 'Status proses, petunjuk, tautan', ramp: 'samudra', text: 7, symbol: '●' },
  { name: 'Peringatan', use: 'Nilai tinggi, perlu tindakan, override', ramp: 'kunyit', text: 8, symbol: '▲' },
  { name: 'Kritis', use: 'Nilai kritis, alergi berat, blokir', ramp: 'koral', text: 8, symbol: '■' },
  { name: 'Netral', use: 'Menunggu, draf, nonaktif', ramp: 'batu', text: 8, symbol: '○' },
];

const DOMAIN_SCOPE: Record<DomainKey, string> = {
  fo: 'Pendaftaran, jadwal, antrean, anjungan, rujukan',
  kl: 'Poli, IGD, rawat inap, CPOE, resume',
  pj: 'Lab, radiologi, farmasi, bank darah, OK',
  ku: 'Kasir, klaim, akuntansi, BTN × TPDI',
  mj: 'Dasbor, mutu, logistik, SDM, aset',
  si: 'Akses, audit, pengaturan, integrasi',
};

/** Gradien domain gelap → terang (800 → 600; batu 800 → 700 seperti `data-domain="si"`). */
const domainGradient = (ramp: RampName) =>
  `linear-gradient(135deg, var(--color-${ramp}-800), var(--color-${ramp}-${ramp === 'batu' ? '700' : '600'}))`;

const COLOR_RULES = [
  [
    'Satu aksi utama per area',
    'Hanya tombol primer yang bergradien penuh; aksi lain sekunder (putih + garis).',
  ],
  [
    'Domain bukan status',
    'Anggrek menandai penunjang, bukan "berhasil". Status selalu zamrud, samudra, kunyit, atau koral.',
  ],
  [
    'Teks di atas warna',
    'Latar 50–200 memakai teks 700–900 rona yang sama. Teks putih hanya di atas 600 ke atas.',
  ],
  [
    'Gradien satu rona',
    'Gelap → terang dalam satu rona (800 → 600, KPI 100 → 50). Tidak ada gradien lintas rona.',
  ],
  ['Kritis tidak dihias', 'Koral tidak dipakai untuk dekorasi atau grafik agar maknanya tidak luntur.'],
] as const;

/** Warna kategori grafik (urutan tetap, papan F5). */
const CATEGORIES = [
  { label: 'BPJS', share: 58, color: 'var(--color-samudra-500)' },
  { label: 'Umum', share: 22, color: 'var(--color-zamrud-500)' },
  { label: 'Asuransi', share: 9, color: 'var(--color-anggrek-500)' },
  { label: 'Perusahaan', share: 6, color: 'var(--color-kunyit-400)' },
  { label: 'Jamkesda', share: 3, color: 'var(--color-bougenvil-500)' },
  { label: 'Lainnya', share: 2, color: 'var(--color-toska-500)' },
] as const;

const MONTHLY = [
  ['Jan', 70],
  ['Feb', 82],
  ['Mar', 76],
  ['Apr', 90],
  ['Mei', 95],
  ['Jun', 88],
  ['Jul', 102],
  ['Agu', 110],
  ['Sep', 104],
] as const;

type Check = { error: string | null; hint: string | null };

/** Nilai contoh tersamar (fiktif) yang dianggap sudah dicek ke Dukcapil, seperti di mockup. */
const NIK_TERSAMAR = '3174••••••••4521';

function validateNik(nik: string): Check {
  if (nik === NIK_TERSAMAR) return { error: null, hint: 'Terverifikasi Dukcapil' };
  if (!nik) return { error: 'NIK wajib diisi.', hint: null };
  if (/[^0-9]/.test(nik)) return { error: 'NIK hanya berisi angka.', hint: null };
  if (nik.length !== 16) return { error: `NIK harus 16 digit (sekarang ${nik.length}).`, hint: null };
  return { error: null, hint: 'Format benar · siap dicek ke Dukcapil' };
}

function validateTanggal(v: string): Check {
  if (!v) return { error: 'Tanggal lahir wajib diisi.', hint: null };
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return { error: 'Gunakan format dd/mm/yyyy, misalnya 14/03/1972.', hint: null };
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return { error: 'Tanggal tidak valid. Periksa hari dan bulan.', hint: null };
  }
  if (dt > new Date()) return { error: 'Tanggal lahir tidak boleh di masa depan.', hint: null };
  return { error: null, hint: 'Tanggal valid' };
}

const STATUS_FILTERS = ['Menunggu', 'Diperiksa', 'Menunggu hasil', 'Selesai'] as const;

/** Alasan pembatalan minimal (mockup Fondasi): cukup untuk dipahami peninjau jejak audit. */
const REASON_MIN = 5;

/** Skala Poppins (papan F2): ukuran/tinggi baris · ketebalan; judul ber-tracking negatif. */
const TYPE_SCALE = [
  {
    token: 'display 40/44 · 700',
    cls: 'text-[32px] leading-[38px] md:text-[40px] md:leading-[44px] font-bold tracking-[-0.025em]',
    sample: 'Selamat pagi',
  },
  {
    token: 'judul 1 28/34 · 700',
    cls: 'text-[28px] leading-[34px] font-bold tracking-[-0.02em]',
    sample: 'Pemeriksaan poli',
  },
  {
    token: 'judul 2 22/28 · 600',
    cls: 'text-[22px] leading-[28px] font-semibold tracking-[-0.015em]',
    sample: 'Catatan SOAP',
  },
  {
    token: 'judul 3 18/24 · 600',
    cls: 'text-[18px] leading-[24px] font-semibold tracking-[-0.01em]',
    sample: 'Tanda vital · 09.05',
  },
  {
    token: 'isi besar 16/24',
    cls: 'text-[16px] leading-[24px]',
    sample: 'Sering haus dan berkemih malam sejak dua minggu.',
  },
  {
    token: 'isi 14/21',
    cls: 'text-body leading-[21px]',
    sample: 'Metformin 500 mg 2×1, periksa HbA1c, kontrol 2 minggu.',
  },
  {
    token: 'label 13/18 · 500',
    cls: 'text-small leading-[18px] font-medium',
    sample: 'Alasan klinis (wajib, minimal 10 karakter)',
  },
  {
    token: 'keterangan 12/16 · 500',
    cls: 'text-caption leading-4 font-medium text-ink-500',
    sample: 'Tersimpan otomatis · 09.41',
  },
  {
    token: 'overline 12/16 · 600',
    cls: 'text-caption leading-4 font-semibold tracking-[0.08em]',
    sample: 'KLINIS · FRONT OFFICE',
  },
] as const;

const WEIGHTS = [
  ['font-normal', '400 · isi'],
  ['font-medium', '500 · label'],
  ['font-semibold', '600 · judul kecil'],
  ['font-bold', '700 · judul, angka besar'],
] as const;

const SPACES = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

const RADII = [
  ['6', 'rounded-md', 'chip kecil'],
  ['11', 'rounded-control', 'tombol, isian'],
  ['16', 'rounded-card', 'kartu'],
  ['20', 'rounded-window', 'jendela'],
  ['pil', 'rounded-full', 'chip'],
] as const;

const MATERIALS = [
  { title: '0 · datar', note: 'tabel, daftar', cls: 'bg-white/60' },
  { title: '1 · kartu', note: 'isi, formulir', cls: 'bg-white/90 shadow-card' },
  {
    title: '2 · popover',
    note: 'menu, panduan',
    cls: 'bg-white/95 shadow-[0_14px_34px_rgba(23,32,46,0.14)]',
  },
  { title: '3 · palet', note: 'palet, dialog', cls: 'bg-white shadow-float' },
] as const;

/** Pola gerak (papan F4): kelas animasi dari theme.css; diputar ulang dengan memasang ulang contoh. */
const MOTIONS = [
  { id: 'win', title: 'Jendela masuk', spec: '600 ms · muncul halus · keluar-halus (.16, 1, .3, 1)' },
  { id: 'pal', title: 'Palet dan lembar', spec: '340 ms · dari atas · buram 8 px → tajam' },
  { id: 'pop', title: 'Konfirmasi selesai', spec: '450 ms · pop kecil 1,03 · hanya hasil penting' },
  { id: 'stagger', title: 'Isi bertahap', spec: '500 ms · jeda 50 ms per kartu · maks. 5 langkah' },
  { id: 'shine', title: 'Kilau KPI', spec: '1,6 s sekali · tidak berulang' },
  {
    id: 'crit',
    title: 'Denyut kritis',
    spec: '1,6 s berulang · satu-satunya animasi berulang · nilai kritis',
  },
] as const;

function MotionSample({ id }: { id: (typeof MOTIONS)[number]['id'] }) {
  if (id === 'stagger') {
    return (
      <div className="stagger-rise flex gap-2">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className="flex h-14 w-12 items-center justify-center rounded-[10px] bg-white text-caption font-semibold shadow-card"
          >
            {n}
          </span>
        ))}
      </div>
    );
  }
  if (id === 'crit') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-koral-100 px-3 py-1 text-caption font-semibold text-koral-800">
        <span aria-hidden="true" className="size-2 animate-crit rounded-full bg-koral-600" />
        Kritis · Kalium 6,4
      </span>
    );
  }
  if (id === 'pop')
    return <span className="animate-pop font-semibold text-success">✓ Ditandatangani 09.44</span>;
  if (id === 'shine') {
    return (
      <span className="shine-once flex h-16 w-36 flex-col justify-center rounded-[12px] bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] px-3">
        <span className="text-caption text-ink-700">BOR</span>
        <span className="text-[22px] font-bold tracking-[-0.03em]">80,8%</span>
      </span>
    );
  }
  return (
    <span
      className={cx(
        'flex h-16 w-36 items-center justify-center rounded-[14px] border border-white/90 bg-white text-caption font-semibold shadow-window',
        id === 'win' ? 'animate-win-in' : 'animate-pal-in',
      )}
    >
      {id === 'win' ? 'Jendela' : '⌘K Palet'}
    </span>
  );
}

const PRINCIPLES = [
  {
    title: 'Pasien yang benar',
    text: 'Banner identitas tetap di atas. Saat berpindah pasien, layar berganti penuh; tidak ada data pasien lama yang tersisa di form.',
  },
  {
    title: 'Draf dulu, final kemudian',
    text: 'Semua catatan tersimpan otomatis sebagai draf. Status final hanya lewat tanda tangan; setelahnya hanya koreksi berversi atau addendum.',
  },
  {
    title: 'Peringatan yang tidak bising',
    text: 'Peringatan kritis memblokir dan meminta alasan; perhatian tampil di samping tanpa memblokir; info cukup sebagai teks.',
  },
  {
    title: 'Dua klik ke data penting',
    text: 'Alergi, obat aktif, hasil terakhir, dan problem list terlihat tanpa membuka menu.',
  },
  {
    title: 'Keyboard untuk pengguna berat',
    text: 'Palet perintah dengan ⌘K / Ctrl K, simpan dengan Ctrl+S, tanda tangan dengan Ctrl+Enter, berpindah tab dengan Alt+angka.',
  },
  {
    title: 'Selalu jelas statusnya',
    text: 'Setiap aksi yang mengirim ke luar (BPJS, SATUSEHAT, lab) menampilkan status terkirim, gagal, atau menunggu, beserta waktu.',
  },
] as const;

/**
 * Galeri fondasi "Pelangi Klinis" (ADR-0091, papan F1–F5): ramp warna dari `ramps`, rona domain dari `DOMAINS`,
 * tipografi Poppins + IBM Plex Mono, gradien satu rona, kaca, gerak, komponen interaktif dari `@simrs/ui`, dan
 * prinsip interaksi klinis. Data contoh fiktif.
 */
export function Fondasi() {
  const [feedback, setFeedback] = useState<{ text: string; danger: boolean } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [nik, setNik] = useState<string>(NIK_TERSAMAR);
  const [tgl, setTgl] = useState('31/02/1972');
  const [sex, setSex] = useState<'L' | 'P'>('P');
  const [filters, setFilters] = useState<string[]>(['Menunggu']);
  const [satusehat, setSatusehat] = useState(true);
  const [dense, setDense] = useState(false);
  const [tab, setTab] = useState('cppt');
  const [pilTab, setPilTab] = useState('transaksi');
  const [range, setRange] = useState('hari-ini');
  const [draft, setDraft] = useState('');
  const [replay, setReplay] = useState(0);

  const nikV = validateNik(nik);
  const tglV = validateTanggal(tgl);
  const reasonShort = reason.trim().length < REASON_MIN;
  const press = (label: string) => {
    setCancelOpen(false);
    setFeedback({ text: `Tombol ${label} ditekan pukul ${formatJam(new Date())}.`, danger: false });
  };
  const maxMonthly = Math.max(...MONTHLY.map(([, v]) => v));
  const domainKeys = Object.keys(DOMAINS) as DomainKey[];

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold tracking-[0.08em] text-brand-700">
            SIM RS · SISTEM DESAIN
          </span>
          <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] md:text-[40px] md:tracking-[-0.025em]">
            Pelangi Klinis
          </h1>
          <p className="m-0 max-w-[760px] text-ink-700">
            Fungsional, berwarna, dan tenang: tujuh rona plus satu netral. Rona domain memberi identitas
            modul, warna status hanya dipakai untuk arti, gradien selalu satu rona, dan keselamatan pasien
            (alergi, nilai kritis, peringatan) tetap paling cepat terlihat.
          </p>
        </div>
        <span className="text-small text-ink-500">Versi 1.0 · 6 Okt 2026 · ADR-0091</span>
      </header>

      <Section
        id="h-warna"
        title="1. Warna"
        lead="Skala 50–900 per rona. Angka = rasio kontras teks contoh di atas warnanya; teks normal wajib ≥ 4,5:1 (AA)."
      >
        <div className="flex flex-col gap-3">
          {RAMP_ROLES.map((r) => (
            <Card key={r.ramp} className="flex flex-col gap-2.5 p-4">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[16px] font-semibold">{r.label}</span>
                <span className="text-caption text-ink-500">{r.role}</span>
              </span>
              <div className="grid grid-cols-5 gap-1.5 lg:grid-cols-10">
                {ramps[r.ramp].map((hex, i) => {
                  const fg = i >= 6 ? WHITE : INK;
                  const ratio = contrast(hex, fg);
                  return (
                    <div
                      key={hex}
                      className="flex min-h-[76px] min-w-0 flex-col justify-between rounded-[12px] px-2 pt-2.5 pb-2"
                      style={{ background: `var(--color-${r.ramp}-${RAMP_STEPS[i]})`, color: fg }}
                    >
                      <span className="text-small font-bold">{RAMP_STEPS[i]}</span>
                      <span className="text-caption leading-tight">
                        <span className="font-mono break-all">{hex}</span>
                        <br />
                        {ratioText(ratio)} {ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA besar' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card className="flex flex-col gap-3 p-5">
            <span className="font-semibold">Warna status (tidak ikut domain)</span>
            {STATUS_COLORS.map((st) => (
              <div key={st.name} className="flex flex-wrap items-center gap-3">
                <span
                  className="inline-flex min-w-[124px] items-center gap-1.5 rounded-full px-[11px] py-1 text-caption font-semibold"
                  style={{
                    background: `var(--color-${st.ramp}-100)`,
                    color: `var(--color-${st.ramp}-${RAMP_STEPS[st.text]})`,
                  }}
                >
                  <span aria-hidden="true">{st.symbol}</span>
                  {st.name}
                </span>
                <span className="min-w-0 flex-1 text-small text-ink-700">{st.use}</span>
                <span className="font-mono text-caption text-ink-500">
                  100/{RAMP_STEPS[st.text]} ·{' '}
                  {ratioText(contrast(ramps[st.ramp][1], ramps[st.ramp][st.text] ?? INK))}
                </span>
              </div>
            ))}
            <span className="text-caption text-ink-500">
              Status selalu berupa simbol + teks, tidak pernah warna saja.
            </span>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <span className="font-semibold">Gradien satu rona</span>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex h-16 flex-col justify-end rounded-[12px] bg-fajar p-2.5 text-white">
                <span className="text-caption font-semibold">Fajar · samudra</span>
                <span className="text-caption opacity-90">logo, merek</span>
              </div>
              {domainKeys.map((k) => (
                <div
                  key={k}
                  className="flex h-16 flex-col justify-end rounded-[12px] p-2.5 text-white"
                  style={{ backgroundImage: domainGradient(DOMAINS[k].ramp) }}
                >
                  <span className="text-caption font-semibold">{DOMAINS[k].label}</span>
                  <span className="text-caption opacity-90">menu aktif, tombol</span>
                </div>
              ))}
              <div className="flex h-16 flex-col justify-end rounded-[12px] bg-[linear-gradient(135deg,var(--color-samudra-100),var(--color-samudra-50))] p-2.5">
                <span className="text-caption font-semibold">KPI 100 → 50</span>
                <span className="text-caption text-ink-500">kartu ringkasan</span>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {triageLevels.map((t) => (
            <div
              key={t.level}
              className="flex flex-col gap-0.5 rounded-[12px] border px-3.5 py-3"
              style={{ background: t.bg, color: t.fg, borderColor: t.border }}
            >
              <span className="text-caption font-semibold">Triase {t.level}</span>
              <span className="text-[16px] font-bold">{t.label}</span>
              <span className="text-caption">{t.target}</span>
            </div>
          ))}
        </div>
        <p className="m-0 text-small text-ink-700">
          Warna triase hanya dipakai di IGD dan selalu disertai angka level dan label. Koral dicadangkan untuk
          alergi, nilai kritis, dan tindakan berbahaya.
        </p>

        <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-5">
          {COLOR_RULES.map(([title, text], i) => (
            <li key={title} className="flex flex-col gap-1 rounded-[12px] bg-white/70 p-3.5">
              <span className="font-semibold">
                {i + 1} · {title}
              </span>
              <span className="text-small text-ink-700">{text}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="h-domain"
        title="2. Rona domain dan visualisasi data"
        lead="Setiap kelompok modul punya rona identitas. Di dalam [data-domain], kelas brand-* otomatis menjadi rona domain itu."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {domainKeys.map((k) => {
            const d = DOMAINS[k];
            return (
              <Card key={k} className="flex flex-col overflow-hidden">
                <div
                  className="flex h-24 flex-col justify-between p-4 text-white"
                  style={{ backgroundImage: domainGradient(d.ramp) }}
                >
                  <span className="text-caption opacity-90">
                    {d.ramp} · <span className="font-mono">data-domain=&quot;{k}&quot;</span>
                  </span>
                  <span className="text-[20px] font-bold tracking-[-0.01em]">{d.label}</span>
                </div>
                <div className="flex flex-col gap-2 px-4 py-3.5">
                  <span className="text-small text-ink-500">{DOMAIN_SCOPE[k]}</span>
                  <span
                    className="self-start rounded-full px-[11px] py-1 text-caption font-semibold"
                    style={{
                      background: `var(--color-${d.ramp}-${d.ramp === 'batu' ? '200' : '100'})`,
                      color: `var(--color-${d.ramp}-800)`,
                    }}
                  >
                    label {d.label.toLowerCase()}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <span className="font-semibold">Warna kategori (urutan tetap)</span>
            <div
              className="flex h-[22px] gap-0.5 overflow-hidden rounded-lg"
              role="img"
              aria-label={`Contoh bauran penjamin: ${CATEGORIES.map((c) => `${c.label} ${c.share}%`).join(', ')}`}
            >
              {CATEGORIES.map((c) => (
                <span key={c.label} style={{ flex: c.share, background: c.color }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
              {CATEGORIES.map((c) => (
                <span key={c.label} className="flex items-center gap-1.5 text-small">
                  <span aria-hidden="true" className="size-3 rounded-[4px]" style={{ background: c.color }} />
                  {c.label} · {c.share}%
                </span>
              ))}
            </div>
            <span className="text-caption text-ink-500">
              Maksimal 6 kategori; sisanya digabung &ldquo;Lainnya&rdquo;. Label angka selalu ditulis.
            </span>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <span className="font-semibold">Satu seri · gradien rona domain</span>
            <div
              role="img"
              aria-label={`Contoh pendapatan bulanan (Rp miliar), Januari–September: ${MONTHLY.map(([m, v]) => `${m} ${v}`).join(', ')}`}
              className="flex h-[130px] items-end gap-2 border-b border-line pb-1"
            >
              {MONTHLY.map(([m, v]) => (
                <span key={m} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span
                    className="w-full max-w-[38px] rounded-[8px_8px_4px_4px] bg-[linear-gradient(180deg,var(--color-brand-300),var(--color-brand-600))]"
                    style={{ height: Math.round((v / maxMonthly) * 100) }}
                  />
                  <span className="font-mono text-caption text-ink-500">{m}</span>
                </span>
              ))}
            </div>
            <span className="text-caption text-ink-500">
              Seri tunggal memakai satu rona (300 → 600), bukan pelangi. Garis sasaran memakai kunyit
              putus-putus.
            </span>
          </Card>
        </div>
      </Section>

      <Card className="p-6">
        <Section
          id="h-tipo"
          title="3. Tipografi"
          lead="Poppins untuk seluruh antarmuka. Hierarki dari ukuran + ketebalan + jarak baris; huruf besar dirapatkan."
        >
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="flex min-w-0 flex-col gap-3">
              {TYPE_SCALE.map((t) => (
                <div
                  key={t.token}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-soft pb-2.5"
                >
                  <span className="w-[150px] shrink-0 font-mono text-caption text-ink-500">{t.token}</span>
                  <span className={cx('min-w-0', t.cls)}>{t.sample}</span>
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-2.5">
                {WEIGHTS.map(([cls, label]) => (
                  <div key={cls} className="flex flex-col gap-1 rounded-control bg-brand-50 p-3">
                    <span className={cx('text-[26px] leading-none', cls)}>Aa Rr 09</span>
                    <span className="text-caption text-ink-700">Poppins {label}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 rounded-control bg-brand-50 p-4">
                <span className="text-kpi leading-tight font-bold tracking-[-0.03em]">80,8%</span>
                <span className="text-ink-700">
                  Angka tabular (<span className="font-mono">tabular-nums</span>) untuk dosis, tarif, dan
                  tanda vital: 148/92 · 286 · Rp 1.250.400.
                </span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-control bg-brand-50 p-4">
                <span className="font-mono font-semibold">IBM Plex Mono · 00-21-45-77 · I10 · E11.9</span>
                <span className="text-ink-700">
                  Hanya untuk pengenal: nomor RM, kode ICD, nomor SEP, nomor resep, kode barang. Membantu
                  verifikasi karakter per karakter.
                </span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-control bg-brand-50 p-4">
                <span className="font-semibold">Aturan</span>
                <span className="text-ink-700">
                  Minimal 12 px (anjungan 20 px, TV 28 px). Penekanan dengan 600/700, bukan HURUF BESAR.
                  Format baku: Sen, 5 Okt 2026 · 07.10 · Rp 1.250.400 · 36,8 °C.
                </span>
              </div>
            </div>
          </div>
        </Section>
      </Card>

      <Section
        id="h-gerak"
        title="4. Material, bentuk, dan gerak"
        lead="Kaca hanya untuk navigasi dan bingkai; isi klinis selalu di permukaan solid. Gerak memberi umpan balik dan arah, bukan hiasan."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex min-w-0 flex-col gap-3 p-5">
            <span className="font-semibold">Material</span>
            <div className="rounded-[14px] bg-[radial-gradient(420px_220px_at_0%_0%,var(--color-samudra-100),transparent_60%),radial-gradient(360px_200px_at_100%_100%,var(--color-samudra-50),transparent_60%)] p-3.5">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="glass-soft flex h-20 flex-col justify-end rounded-[12px] border border-white/70 p-2.5">
                  <span className="text-caption font-semibold">Kaca tipis</span>
                  <span className="text-caption text-ink-700">sidebar</span>
                </div>
                <div className="glass flex h-20 flex-col justify-end rounded-[12px] border border-white/85 p-2.5">
                  <span className="text-caption font-semibold">Kaca tebal</span>
                  <span className="text-caption text-ink-700">jendela</span>
                </div>
                <div className="flex h-20 flex-col justify-end rounded-[12px] border border-white/95 bg-white p-2.5">
                  <span className="text-caption font-semibold">Solid</span>
                  <span className="text-caption text-ink-700">isi</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {MATERIALS.map((m) => (
                <div
                  key={m.title}
                  className={cx(
                    'flex h-20 flex-col justify-end rounded-[12px] border border-white/95 p-2.5',
                    m.cls,
                  )}
                >
                  <span className="text-caption font-semibold">{m.title}</span>
                  <span className="text-caption text-ink-500">{m.note}</span>
                </div>
              ))}
            </div>
            <span className="text-caption text-ink-500">
              &ldquo;Kurangi transparansi&rdquo; di sistem operasi mengganti semua kaca dengan permukaan
              solid.
            </span>
          </Card>
          <Card className="flex min-w-0 flex-col gap-3 p-5">
            <span className="font-semibold">Jarak, sudut, dan target sentuh</span>
            <div className="flex flex-wrap items-end gap-3">
              {SPACES.map((sp) => (
                <div key={sp} className="flex flex-col items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="rounded-[3px] bg-btn-primary"
                    style={{ width: Math.min(sp, 32), height: sp }}
                  />
                  <span className="font-mono text-caption text-ink-700">{sp}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {RADII.map(([label, cls, use]) => (
                <span key={label} className="flex flex-col items-center gap-1">
                  <span
                    className={cx(
                      'flex h-11 w-16 items-center justify-center border-2 border-brand-600 bg-brand-50 text-caption font-semibold',
                      cls,
                    )}
                  >
                    {label}
                  </span>
                  <span className="text-caption text-ink-500">{use}</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-11 shrink-0 rounded-control border-2 border-dashed border-brand-600"
              />
              <span className="text-small text-ink-700">
                Target sentuh minimum 44 × 44 px (anjungan 64 px)
              </span>
            </div>
          </Card>
        </div>
        <Card className="flex flex-col gap-3.5 p-5">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">Pola gerak</span>
            <Button onClick={() => setReplay((n) => n + 1)}>
              <Icon name="play" size={14} /> Putar ulang animasi
            </Button>
          </span>
          <div key={replay} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MOTIONS.map((m) => (
              <div key={m.id} className="flex min-w-0 flex-col gap-2.5 rounded-[12px] bg-brand-50/70 p-3.5">
                <div className="flex h-20 items-center justify-center">
                  <MotionSample id={m.id} />
                </div>
                <span className="flex flex-col">
                  <span className="text-small font-semibold">{m.title}</span>
                  <span className="text-caption text-ink-500">{m.spec}</span>
                </span>
              </div>
            ))}
          </div>
          <span className="text-caption text-ink-500">
            Animasi hanya memakai transform dan opacity, bisa disela, dan dimatikan bila pengguna memilih
            &ldquo;kurangi gerakan&rdquo;. Tombol menyusut ke 0,97 saat ditekan.
          </span>
        </Card>
      </Section>

      <Section id="h-komp" title="5. Komponen">
        <div className="grid gap-4 lg:grid-cols-2">
          <Demo
            title="Tombol"
            note="Satu tombol utama per area. Aksi final klinis (tanda tangan, verifikasi, serahkan obat) selalu tombol utama di kanan bawah; aksi destruktif selalu meminta konfirmasi dan alasan. Semua ukuran setinggi 44 px; sm hanya lebih ringkas ke samping."
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="primary" onClick={() => press('Utama')}>
                Utama
              </Button>
              <Button onClick={() => press('Sekunder')}>Sekunder</Button>
              <Button variant="ghost" onClick={() => press('Teks')}>
                Teks
              </Button>
              <Button
                variant="danger"
                aria-expanded={cancelOpen}
                onClick={() => {
                  setCancelOpen(true);
                  setReason('');
                  setFeedback(null);
                }}
              >
                Batalkan tindakan
              </Button>
              <Button variant="primary" disabled>
                Nonaktif
              </Button>
              <Button size="sm" onClick={() => press('Ringkas')}>
                Ringkas (sm)
              </Button>
            </div>
            {cancelOpen && (
              <div className="flex flex-col gap-2 rounded-control border border-koral-200 bg-alert-critical px-3.5 py-3">
                <Field
                  label="Alasan pembatalan"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  hintTone={reasonShort ? 'muted' : 'success'}
                  hint={
                    reasonShort
                      ? `Tulis alasan minimal ${REASON_MIN} karakter. Pembatalan tercatat di jejak audit.`
                      : 'Alasan cukup. Pembatalan akan tercatat di jejak audit.'
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={reasonShort}
                    onClick={() => {
                      setCancelOpen(false);
                      setFeedback({
                        text: `Tindakan dibatalkan pukul ${formatJam(new Date())} · alasan: ${reason.trim()}`,
                        danger: true,
                      });
                      setReason('');
                    }}
                  >
                    Ya, batalkan
                  </Button>
                  <Button size="sm" onClick={() => setCancelOpen(false)}>
                    Kembali
                  </Button>
                </div>
              </div>
            )}
            {feedback && (
              <span
                role="status"
                className={cx('text-small font-semibold', feedback.danger ? 'text-danger' : 'text-brand-700')}
              >
                {feedback.text}
              </span>
            )}
          </Demo>

          <Demo
            title="Input"
            note="Label selalu terlihat di atas field, tidak hanya placeholder. Pesan galat tepat di bawah field dan menjelaskan cara memperbaiki."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="NIK"
                required
                inputMode="numeric"
                value={nik}
                onChange={(e) => setNik(e.target.value)}
                error={nikV.error}
                hint={nikV.hint}
              />
              <Field
                label="Tanggal lahir"
                required
                placeholder="dd/mm/yyyy"
                value={tgl}
                onChange={(e) => setTgl(e.target.value)}
                error={tglV.error}
                hint={tglV.hint}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="penjamin" className="text-small font-semibold text-ink-700">
                  Penjamin
                </label>
                <select
                  id="penjamin"
                  className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
                >
                  <option>BPJS Kesehatan</option>
                  <option>Umum</option>
                  <option>Asuransi swasta</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-small font-semibold text-ink-700">Jenis kelamin</span>
                <div role="group" aria-label="Jenis kelamin" className="flex gap-1.5">
                  {(['P', 'L'] as const).map((s) => {
                    const on = sex === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSex(s)}
                        className={cx(
                          'h-11 flex-1 cursor-pointer rounded-control border font-[inherit]',
                          on
                            ? 'border-transparent bg-btn-primary font-semibold text-white shadow-button'
                            : 'border-line-strong bg-white text-ink-700',
                        )}
                      >
                        {s === 'L' ? 'Laki-laki' : 'Perempuan'}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Demo>

          <Demo
            title="Status, label, dan chip"
            note="Status tidak pernah dibedakan hanya dengan warna: selalu ada teks. Chip kode memakai Mono."
          >
            <div className="flex flex-wrap gap-2">
              <StatusChip status="diperiksa">Diperiksa</StatusChip>
              <StatusChip status="menunggu">Menunggu</StatusChip>
              <StatusChip status="menunggu-hasil">Menunggu hasil</StatusChip>
              <StatusChip status="selesai">Selesai</StatusChip>
              <StatusChip status="dibatalkan">Dibatalkan</StatusChip>
              <StatusChip status="terkirim">Terkirim SATUSEHAT</StatusChip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-koral-100 px-[11px] py-1 text-caption font-bold text-koral-800">
                <Icon name="alert" size={13} strokeWidth={2} />
                Alergi: Amoksisilin
              </span>
              <span className="rounded-full bg-kunyit-100 px-[11px] py-1 text-caption font-semibold text-kunyit-800">
                ▲ Risiko jatuh tinggi
              </span>
              <span className="rounded-full bg-batu-200 px-[11px] py-1 text-caption font-semibold text-batu-800">
                Pasien rahasia
              </span>
              <span className="rounded-control bg-brand-100 px-2.5 py-1.5 text-small text-brand-800">
                <span className="font-mono font-semibold text-brand-700">I10</span> Hipertensi esensial
              </span>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
              <span className="text-caption font-semibold text-ink-700">
                Chip filter (bisa dipilih) ·{' '}
                {filters.length ? `${filters.length} dipilih` : 'belum ada yang dipilih'}
              </span>
              <div role="group" aria-label="Filter status" className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((f) => (
                  <FilterChip
                    key={f}
                    selected={filters.includes(f)}
                    onClick={() =>
                      setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
                    }
                  >
                    {f}
                  </FilterChip>
                ))}
              </div>
            </div>
          </Demo>

          <Demo title="Peringatan klinis (4 tingkat)">
            <Alert level="critical">Kalium 6,8 mmol/L. Wajib konfirmasi DPJP dalam 30 menit.</Alert>
            <Alert level="warning">Dosis amlodipin dinaikkan 5 → 10 mg.</Alert>
            <Alert level="info">SEP terbit otomatis dari rujukan FKTP.</Alert>
            <Alert level="success">Resume ditandatangani dan dikirim ke SATUSEHAT.</Alert>
          </Demo>

          <Demo
            title="Toggle"
            note="Toggle untuk pengaturan yang langsung berlaku tanpa tombol simpan. Status selalu tertulis di samping sakelar. Mode padat langsung terlihat di tabel data di bawah."
          >
            {[
              {
                id: 'tg-ss',
                label: 'Kirim otomatis ke SATUSEHAT',
                desc: 'Setelah resume ditandatangani',
                on: satusehat,
                set: setSatusehat,
              },
              {
                id: 'tg-padat',
                label: 'Mode padat',
                desc: 'Baris tabel 36 px untuk layar kerja',
                on: dense,
                set: setDense,
              },
            ].map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span id={t.id} className="text-small font-semibold">
                    {t.label}
                  </span>
                  <span className="text-caption text-ink-500">{t.desc}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.on}
                  aria-labelledby={t.id}
                  onClick={() => t.set(!t.on)}
                  className={cx(
                    'inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-1 text-caption font-semibold',
                    t.on ? 'text-brand-700' : 'text-ink-500',
                  )}
                >
                  <span
                    className={cx(
                      'flex h-6 w-11 items-center rounded-full border p-0.5',
                      t.on
                        ? 'justify-end border-transparent bg-btn-primary'
                        : 'justify-start border-line-strong bg-line',
                    )}
                  >
                    <span className="size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(23,32,46,0.25)]" />
                  </span>
                  {t.on ? 'Aktif' : 'Nonaktif'}
                </button>
              </div>
            ))}
          </Demo>

          <Demo
            title="Tab"
            note="Tab mengganti isi di tempat tanpa memuat ulang halaman. Tab aktif ditandai gradien rona domain dan teks tebal, bukan warna saja."
          >
            <Tabs
              label="Contoh tab rekam medis"
              value={tab}
              onChange={setTab}
              items={[
                {
                  id: 'cppt',
                  label: 'CPPT',
                  content: (
                    <TabSample title="CPPT · SOAP 3 Okt 2026 08.42">
                      S: pusing dan tengkuk berat sejak 3 hari. O: TD 162/98 mmHg. A: hipertensi esensial
                      (I10). P: amlodipin 10 mg.
                    </TabSample>
                  ),
                },
                {
                  id: 'ttv',
                  label: 'Tanda vital',
                  content: (
                    <TabSample title="Tanda vital terakhir · 08.30">
                      TD 162/98 mmHg · nadi 88 x/menit · suhu 36,8 °C · SpO2 98% · BB 64 kg.
                    </TabSample>
                  ),
                },
                {
                  id: 'resep',
                  label: 'Resep',
                  content: (
                    <TabSample title="Resep aktif · 1 item">
                      Amlodipin 10 mg, 1 x 1 tablet pagi, 30 hari. Telaah apoteker: tidak ada interaksi.
                    </TabSample>
                  ),
                },
              ]}
            />
          </Demo>

          <Demo
            title="Banner identitas pasien (wajib di setiap layar klinis)"
            note="Dua pengenal (nama + tanggal lahir atau No. RM) sesuai SKP 1 identifikasi pasien. Alergi berada dalam satu baris pandang dengan nama. Banner tidak pernah tergulir keluar layar."
            className="lg:col-span-2"
          >
            <PatientBanner
              name="Siti Rahmawati"
              sex="P"
              ageYears={54}
              birthDate="14 Mar 1972"
              mrn="00-12-45-78"
              allergies={['Amoksisilin']}
              guarantor="BPJS Kelas 2"
              attending="dr. [Nama]"
            />
          </Demo>

          <Demo
            title="Tabel data"
            note="Baris 44 px untuk layar kerja, 36 px untuk mode padat. Angka rata kanan saat dibandingkan antar baris. Nilai abnormal: warna + teks flag."
            className="lg:col-span-2"
          >
            <div className="overflow-x-auto rounded-control border border-white/95 bg-white/90">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead className="text-caption font-semibold text-ink-500 [&_th]:border-b [&_th]:border-[rgba(23,32,46,0.08)]">
                  <tr>
                    <th scope="col" className="px-3.5 py-2.5">
                      Pemeriksaan
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 text-right">
                      Hasil
                    </th>
                    <th scope="col" className="px-3.5 py-2.5">
                      Satuan
                    </th>
                    <th scope="col" className="px-3.5 py-2.5">
                      Rujukan
                    </th>
                    <th scope="col" className="px-3.5 py-2.5">
                      Flag
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Hemoglobin', value: '12,8', unit: 'g/dL', ref: '12,0–15,5', flag: null },
                    { name: 'Kalium', value: '6,8', unit: 'mmol/L', ref: '3,5–5,1', flag: 'Kritis' },
                  ].map((r) => (
                    <tr
                      key={r.name}
                      className={cx(
                        'border-t border-line-soft transition-colors hover:bg-brand-50/60',
                        dense ? 'h-9' : 'h-11',
                        r.flag && 'bg-koral-50',
                      )}
                    >
                      <td className="px-3.5">{r.name}</td>
                      <td
                        className={cx(
                          'px-3.5 text-right',
                          r.flag ? 'font-bold text-danger' : 'font-semibold',
                        )}
                      >
                        {r.value}
                      </td>
                      <td className="px-3.5 text-ink-500">{r.unit}</td>
                      <td className="px-3.5 text-ink-500">{r.ref}</td>
                      <td className={cx('px-3.5', r.flag && 'font-bold text-danger')}>{r.flag ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Demo>
        </div>

        <h3 className="m-0 text-[16px] font-semibold">Komponen tambahan di @simrs/ui</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <Demo
            title="Tab pil · panel tetap terpasang"
            note="Isian yang belum disimpan tidak hilang saat berpindah tab (keepMounted). Lencana selalu bertulisan."
          >
            <Tabs
              label="Contoh tab pil"
              variant="pil"
              keepMounted
              value={pilTab}
              onChange={setPilTab}
              items={[
                {
                  id: 'transaksi',
                  label: 'Transaksi',
                  badge: '3 menunggu',
                  content: (
                    <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
                      Catatan transaksi (belum disimpan)
                      <textarea
                        rows={2}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] font-normal text-ink-900"
                      />
                    </label>
                  ),
                },
                {
                  id: 'rekon',
                  label: 'Rekonsiliasi',
                  badge: '1 selisih',
                  badgeTone: 'danger',
                  content:
                    'Mutasi BTN dicocokkan dengan transaksi TPDI dan jurnal: 1 selisih menunggu catatan.',
                },
              ]}
            />
          </Demo>
          <Demo
            title="Segmen pilihan (radio)"
            note="Memilih satu nilai/mode (rentang dasbor, mode koneksi, kanal bayar): radiogroup, panah memindah pilihan. Tampak 36 px, area sentuh 44 px. Untuk berpindah panel pakai TabList gaya segmen."
          >
            <div className="flex">
              <RadioSegmented
                label="Rentang"
                value={range}
                onChange={setRange}
                items={[
                  { id: 'hari-ini', label: 'Hari ini' },
                  { id: 'bulan', label: 'Bulan berjalan' },
                  { id: 'ytd', label: 'YTD' },
                ]}
              />
            </div>
            <span role="status" className="text-small text-ink-700">
              Rentang dipilih:{' '}
              {range === 'hari-ini' ? 'Hari ini' : range === 'bulan' ? 'Bulan berjalan' : 'YTD'}
            </span>
          </Demo>
          <Demo
            title="Kartu KPI"
            note="Gradien satu rona 100 → 50 dan kilau sekali. Angka besar, keterangan berwarna sesuai arah, selalu bertulisan."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard
                label="Kunjungan hari ini"
                value="312"
                hint="+8% dari rata-rata"
                tone="success"
                tinted
              />
              <KpiCard label="Klaim pending" value="27" hint="5 lewat 14 hari" tone="warning" tinted />
            </div>
          </Demo>
          <Demo title="Chip nada" note="Chip berlatar untuk status singkat di tabel dan kartu.">
            <div className="flex flex-wrap gap-2">
              <Chip tone="danger" icon={<Icon name="alert" size={13} strokeWidth={2} />}>
                Alergi: Amoksisilin
              </Chip>
              <Chip tone="warning">Risiko jatuh tinggi</Chip>
              <Chip tone="neutral">Pasien rahasia</Chip>
              <Chip tone="brand">
                <span className="font-mono">I10</span> Hipertensi esensial
              </Chip>
            </div>
          </Demo>
        </div>
      </Section>

      <Card className="p-6">
        <Section id="h-prinsip" title="6. Prinsip interaksi klinis">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="flex flex-col gap-1.5 rounded-control bg-brand-50 p-3.5">
                <span className="font-semibold">{p.title}</span>
                <span className="text-small text-ink-700">{p.text}</span>
              </div>
            ))}
          </div>
        </Section>
      </Card>
    </div>
  );
}

function TabSample({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-16 flex-col gap-1.5 rounded-control bg-brand-50 px-3.5 py-3">
      <span className="font-semibold">{title}</span>
      <span className="text-small text-ink-700">{children}</span>
    </div>
  );
}
