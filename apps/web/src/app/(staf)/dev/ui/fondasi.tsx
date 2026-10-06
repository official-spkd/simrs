'use client';

import { formatJam } from '@simrs/shared';
import {
  Alert,
  Button,
  Card,
  Chip,
  cx,
  Field,
  FilterChip,
  Icon,
  KpiCard,
  palettes,
  PatientBanner,
  RadioSegmented,
  StatusChip,
  Tabs,
  triageLevels,
} from '@simrs/ui';
import { type ReactNode, useState } from 'react';

/** Bagian bernomor galeri (design/mockups/Fondasi.dc.html): judul 20 px di atas isi. */
function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cx('flex flex-col gap-4', className)}>
      <h2 id={id} className="m-0 text-[20px] font-semibold">
        {title}
      </h2>
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

const TYPE_SCALE = [
  { token: 'display / 28', cls: 'text-[28px] font-bold', sample: 'Pemeriksaan pasien' },
  { token: 'judul / 20', cls: 'text-[20px] font-semibold', sample: 'CPPT · SOAP' },
  { token: 'subjudul / 16', cls: 'text-[16px] font-semibold', sample: 'Hasil lab terakhir' },
  { token: 'isi / 14', cls: 'text-body', sample: 'Pusing dan tengkuk terasa berat sejak 3 hari.' },
  { token: 'kecil / 13', cls: 'text-small', sample: 'Perempuan · 54 tahun · BPJS Kelas 2' },
  { token: 'label / 12', cls: 'text-caption font-semibold', sample: 'TANDA VITAL · 08.42' },
] as const;

const SPACES = [4, 8, 12, 16, 20, 24, 32, 48] as const;

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
    text: 'Pencarian dengan "/", simpan dengan Ctrl+S, tanda tangan dengan Ctrl+Enter, berpindah tab dengan Alt+angka.',
  },
  {
    title: 'Selalu jelas statusnya',
    text: 'Setiap aksi yang mengirim ke luar (BPJS, SATUSEHAT, lab) menampilkan status terkirim, gagal, atau menunggu, beserta waktu.',
  },
] as const;

/**
 * Galeri fondasi "Klinis Bersih" (design/mockups/Fondasi.dc.html): warna, latar, tipografi, spasi, komponen
 * interaktif dari `@simrs/ui`, dan prinsip interaksi klinis. Data contoh fiktif.
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

  const nikV = validateNik(nik);
  const tglV = validateTanggal(tgl);
  const reasonShort = reason.trim().length < REASON_MIN;
  const press = (label: string) => {
    setCancelOpen(false);
    setFeedback({ text: `Tombol ${label} ditekan pukul ${formatJam(new Date())}.`, danger: false });
  };

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold tracking-[0.1em] text-brand-700">
            SIM RS · DESIGN SYSTEM
          </span>
          <h1 className="m-0 text-[28px] font-bold tracking-[-0.01em] md:text-[36px]">Klinis Bersih</h1>
          <p className="m-0 max-w-[720px] text-ink-700">
            Bahasa visual untuk seluruh layar SIM RS: tenang, padat informasi tanpa sesak, dan selalu
            menempatkan keselamatan pasien (alergi, nilai kritis, peringatan) di posisi yang paling cepat
            terlihat.
          </p>
        </div>
        <span className="text-small text-ink-500">Versi 0.1 · 3 Okt 2026</span>
      </header>

      <Section id="h-warna" title="1. Warna">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {palettes.map((p) => (
            <Card key={p.name} className="flex flex-col gap-2.5 p-4">
              <span className="font-semibold">{p.name}</span>
              <span className="text-caption text-ink-500">{p.use}</span>
              {p.swatches.map(([name, hex]) => (
                <div key={name} className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="h-8 w-10 shrink-0 rounded-lg border border-[rgba(20,33,43,0.08)]"
                    style={{ background: hex }}
                  />
                  <span className="flex flex-col leading-tight">
                    <span className="text-small font-medium">{name}</span>
                    <span className="font-mono text-caption text-ink-500">{hex}</span>
                  </span>
                </div>
              ))}
            </Card>
          ))}
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
          Warna triase hanya dipakai di IGD dan selalu disertai angka level dan label, tidak pernah warna
          saja. Merah semantik (var(--color-koral-600)) dicadangkan untuk alergi, nilai kritis, dan tindakan berbahaya.
        </p>
      </Section>

      <Section id="h-latar" title="2. Latar, gradien, dan elevasi">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex h-[140px] items-end rounded-card border border-line bg-canvas bg-[radial-gradient(420px_160px_at_90%_-10%,color-mix(in_srgb,_var(--color-brand-600)_12%,_transparent),transparent_70%),radial-gradient(circle_at_1px_1px,rgba(20,33,43,0.09)_1px,rgba(20,33,43,0)_1.5px)] bg-[length:auto,22px_22px] p-3.5">
            <span className="rounded-md bg-white px-2 py-1 text-small">
              Latar halaman: titik 7% + cahaya teal 9%
            </span>
          </div>
          <div className="flex h-[140px] items-end rounded-card border border-brand-200 bg-[linear-gradient(100deg,color-mix(in_srgb,_var(--color-brand-600)_8%,_transparent)_0%,#FFFFFF_55%)] p-3.5">
            <span className="text-small">
              Gradien banner: teal 8% → putih, hanya untuk identitas pasien dan header modul
            </span>
          </div>
          <div className="flex h-[140px] items-end rounded-card border border-line bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_12px_rgba(16,24,40,0.06)]">
            <span className="text-small">Kartu: putih, garis var(--color-line), bayangan sangat tipis, radius 14</span>
          </div>
        </div>
      </Section>

      <Card className="p-6">
        <Section id="h-tipo" title="3. Tipografi">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              {TYPE_SCALE.map((t) => (
                <div
                  key={t.token}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-soft pb-2.5"
                >
                  <span className="w-[120px] shrink-0 font-mono text-caption text-ink-500">{t.token}</span>
                  <span className={cx('min-w-0', t.cls)}>{t.sample}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 rounded-control bg-subtle p-4">
                <span className="font-semibold">IBM Plex Sans</span>
                <span className="text-ink-700">
                  Seluruh teks antarmuka. Angka tabular untuk dosis, tarif, dan tanda vital.
                </span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-control bg-subtle p-4">
                <span className="font-mono font-semibold">IBM Plex Mono · 00-12-45-78 · I10 · E11.9</span>
                <span className="text-ink-700">
                  Hanya untuk pengenal: nomor RM, kode ICD, nomor SEP, nomor resep, kode barang. Membantu
                  verifikasi visual karakter per karakter.
                </span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-control bg-subtle p-4">
                <span className="font-semibold">Aturan</span>
                <span className="text-ink-700">
                  Ukuran isi minimum 13 px di layar kerja, 16 px di aplikasi pasien. Tanggal ditulis &ldquo;3
                  Okt 2026&rdquo;, jam &ldquo;08.42&rdquo;. Desimal memakai koma: 36,8 °C. Uang: Rp 1.250.400.
                </span>
              </div>
            </div>
          </div>
        </Section>
      </Card>

      <Card className="p-6">
        <Section id="h-spasi" title="4. Spasi, radius, ukuran sentuh">
          <div className="flex flex-wrap items-end gap-5">
            {SPACES.map((s) => (
              <div key={s} className="flex flex-col items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="rounded-[3px] border border-brand-600 bg-brand-100"
                  style={{ width: s, height: s }}
                />
                <span className="font-mono text-caption text-ink-700">{s}px</span>
              </div>
            ))}
            <span aria-hidden="true" className="hidden h-14 w-px bg-line sm:block" />
            <div className="flex items-end gap-3">
              {[
                ['8', 'rounded-lg'],
                ['10', 'rounded-control'],
                ['14', 'rounded-card'],
                ['pill', 'rounded-full'],
              ].map(([label, cls]) => (
                <span
                  key={label}
                  className={cx(
                    'flex h-10 w-14 items-center justify-center border border-brand-600 text-caption',
                    cls,
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
            <span aria-hidden="true" className="hidden h-14 w-px bg-line sm:block" />
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-11 rounded-lg border-2 border-dashed border-brand-600"
              />
              <span className="text-small text-ink-700">
                Target sentuh minimum 44 × 44 px (anjungan 64 px)
              </span>
            </div>
          </div>
        </Section>
      </Card>

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
              <div className="flex flex-col gap-2 rounded-control border border-koral-200 bg-[linear-gradient(90deg,var(--color-koral-50),#FFFFFF)] px-3.5 py-3">
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
                            ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
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
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-koral-200 bg-koral-50 px-2 py-1 text-caption font-bold text-danger">
                <Icon name="alert" size={13} strokeWidth={2} />
                Alergi: Amoksisilin
              </span>
              <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium">
                Risiko jatuh tinggi
              </span>
              <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium">
                Pasien rahasia
              </span>
              <span className="rounded-control border border-brand-200 bg-selected px-2.5 py-1.5 text-small">
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
                        ? 'justify-end border-brand-800 bg-brand-600'
                        : 'justify-start border-line-strong bg-line',
                    )}
                  >
                    <span className="size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,0.25)]" />
                  </span>
                  {t.on ? 'Aktif' : 'Nonaktif'}
                </button>
              </div>
            ))}
          </Demo>

          <Demo
            title="Tab"
            note="Tab mengganti isi di tempat tanpa memuat ulang halaman. Tab aktif ditandai garis teal dan teks tebal, bukan warna saja."
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
            <div className="overflow-x-auto rounded-control border border-line">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead className="bg-subtle text-caption font-semibold text-ink-700">
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
                        'border-t border-line-soft',
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
          <Demo title="Kartu KPI" note="Angka besar, keterangan berwarna sesuai arah, selalu bertulisan.">
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard label="Kunjungan hari ini" value="312" hint="+8% dari rata-rata" tone="success" />
              <KpiCard label="Klaim pending" value="27" hint="5 lewat 14 hari" tone="warning" />
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
              <div key={p.title} className="flex flex-col gap-1.5 rounded-control bg-subtle p-3.5">
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
    <div className="flex min-h-16 flex-col gap-1.5 rounded-control bg-subtle px-3.5 py-3">
      <span className="font-semibold">{title}</span>
      <span className="text-small text-ink-700">{children}</span>
    </div>
  );
}
