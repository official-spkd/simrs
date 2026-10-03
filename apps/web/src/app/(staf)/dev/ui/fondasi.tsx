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
  spaceScale,
  StatusChip,
  Tabs,
  triageLevels,
} from '@simrs/ui';
import { type ReactNode, useState } from 'react';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="m-0 text-h2 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Demo({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <span className="text-caption font-semibold tracking-wide text-ink-500 uppercase">{title}</span>
      {children}
      {note && <span className="text-caption text-ink-500">{note}</span>}
    </Card>
  );
}

function validateNik(nik: string): { error: string | null; hint: string | null } {
  if (!nik) return { error: 'NIK wajib diisi.', hint: null };
  if (/[^0-9]/.test(nik)) return { error: 'NIK hanya berisi angka.', hint: null };
  if (nik.length !== 16) return { error: `NIK harus 16 digit (sekarang ${nik.length}).`, hint: null };
  return { error: null, hint: 'Format benar · siap dicek ke Dukcapil' };
}

function validateTanggal(v: string): { error: string | null; hint: string | null } {
  if (!v) return { error: 'Tanggal lahir wajib diisi.', hint: null };
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return { error: 'Gunakan format dd/mm/yyyy, misalnya 14/03/1972.', hint: null };
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return { error: 'Tanggal tidak ada di kalender. Periksa hari dan bulan.', hint: null };
  }
  if (dt > new Date()) return { error: 'Tanggal lahir tidak boleh di masa depan.', hint: null };
  return { error: null, hint: 'Tanggal valid' };
}

const STATUS_FILTERS = ['Menunggu', 'Diperiksa', 'Menunggu hasil', 'Selesai'] as const;

export function Fondasi() {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [nik, setNik] = useState('');
  const [tgl, setTgl] = useState('31/02/1972');
  const [sex, setSex] = useState<'L' | 'P'>('P');
  const [filters, setFilters] = useState<string[]>(['Menunggu']);
  const [satusehat, setSatusehat] = useState(true);
  const [dense, setDense] = useState(false);
  const [tab, setTab] = useState('cppt');

  const nikV = validateNik(nik);
  const tglV = validateTanggal(tgl);
  const reasonShort = reason.trim().length < 10;
  const say = (msg: string) => setFeedback(`${msg} · ${formatJam(new Date())}`);

  return (
    <div className="flex max-w-6xl flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <span className="text-caption font-semibold tracking-[0.08em] text-brand-700">
            SIM RS · DESIGN SYSTEM
          </span>
          <h1 className="m-0 text-[28px] font-bold">Klinis Bersih</h1>
          <p className="m-0 text-ink-700">
            Bahasa visual untuk seluruh layar SIM RS: tenang, padat informasi tanpa sesak, dan selalu
            menempatkan keselamatan pasien (alergi, nilai kritis, peringatan) di posisi yang paling cepat
            terlihat.
          </p>
        </div>
        <span className="text-caption text-ink-500">Versi 0.1 · sumber: design/mockups/Fondasi.dc.html</span>
      </header>

      <Section id="h-warna" title="1. Warna">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {palettes.map((p) => (
            <Card key={p.name} className="flex flex-col gap-2 p-4">
              <span className="font-semibold">{p.name}</span>
              <span className="text-caption text-ink-500">{p.use}</span>
              {p.swatches.map(([name, hex]) => (
                <div key={name} className="flex items-center gap-2.5">
                  <span className="size-8 rounded-lg border border-line" style={{ background: hex }} />
                  <span className="flex flex-col">
                    <span className="text-small font-medium">{name}</span>
                    <span className="font-mono text-caption text-ink-500">{hex}</span>
                  </span>
                </div>
              ))}
            </Card>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          {triageLevels.map((t) => (
            <div
              key={t.level}
              className="flex flex-col gap-0.5 rounded-control border px-3 py-2.5"
              style={{ background: t.bg, color: t.fg, borderColor: t.border }}
            >
              <span className="font-bold">Triase {t.level}</span>
              <span className="text-small">{t.label}</span>
              <span className="text-caption">{t.target}</span>
            </div>
          ))}
        </div>
        <p className="m-0 text-small text-ink-700">
          Warna triase hanya dipakai di IGD dan selalu disertai angka level dan label. Merah semantik
          (#B42318) dicadangkan untuk alergi, nilai kritis, dan tindakan berbahaya.
        </p>
      </Section>

      <Section id="h-tipo" title="2. Tipografi, spasi, radius">
        <div className="grid gap-4 md:grid-cols-2">
          <Demo title="Tipografi">
            <span className="text-h1 font-bold">H1 · 20 px · Judul layar</span>
            <span className="text-h2 font-semibold">H2 · 18 px · Judul kartu</span>
            <span className="text-body">Isi · 14 px · Teks kerja utama</span>
            <span className="text-caption text-ink-500">Keterangan · 12 px · Metadata</span>
            <span className="text-kpi font-bold">Rp 1.250.400</span>
            <span className="font-mono">IBM Plex Mono · 00-12-45-78 · I10 · E11.9</span>
          </Demo>
          <Demo title="Spasi dan radius" note="Target sentuh minimum 44 × 44 px; anjungan 64 px.">
            <div className="flex flex-wrap items-end gap-3">
              {spaceScale.map((s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                  <span className="bg-brand-200" style={{ width: s, height: s }} />
                  <span className="font-mono text-caption text-ink-500">{s}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              {[
                ['8', 'rounded-lg'],
                ['10', 'rounded-control'],
                ['14', 'rounded-card'],
                ['pill', 'rounded-full'],
              ].map(([label, cls]) => (
                <span
                  key={label}
                  className={cx(
                    'flex h-11 w-16 items-center justify-center border border-line-strong bg-subtle text-caption',
                    cls,
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          </Demo>
        </div>
      </Section>

      <Section id="h-komp" title="3. Komponen">
        <div className="grid gap-4 lg:grid-cols-2">
          <Demo
            title="Tombol"
            note="Satu tombol utama per area. Aksi destruktif selalu meminta konfirmasi dan alasan."
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => say('Aksi utama dijalankan')}>
                Utama
              </Button>
              <Button onClick={() => say('Aksi sekunder dijalankan')}>Sekunder</Button>
              <Button variant="ghost" onClick={() => say('Tautan teks diklik')}>
                Teks
              </Button>
              <Button variant="danger" aria-expanded={cancelOpen} onClick={() => setCancelOpen(true)}>
                Batalkan tindakan
              </Button>
              <Button variant="primary" disabled>
                Nonaktif
              </Button>
            </div>
            {cancelOpen && (
              <div className="flex flex-col gap-2 rounded-control border border-danger-border bg-danger-bg/40 p-3">
                <Field
                  label="Alasan pembatalan"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={reason && reasonShort ? 'Tulis alasan minimal 10 karakter.' : null}
                  hint={reasonShort ? 'Alasan wajib dan akan tercatat di jejak audit.' : 'Alasan cukup.'}
                />
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={reasonShort}
                    onClick={() => {
                      setCancelOpen(false);
                      setReason('');
                      say('Tindakan dibatalkan dengan alasan tercatat');
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
              <span role="status" className="text-small text-success">
                {feedback}
              </span>
            )}
          </Demo>

          <Demo
            title="Input"
            note="Label selalu terlihat di atas field. Pesan galat menjelaskan cara memperbaiki."
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
                  className="h-10 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
                >
                  <option>BPJS Kesehatan</option>
                  <option>Umum</option>
                  <option>Asuransi swasta</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-small font-semibold text-ink-700">Jenis kelamin</span>
                <div role="group" aria-label="Jenis kelamin" className="flex gap-2">
                  {(['L', 'P'] as const).map((s) => (
                    <FilterChip key={s} selected={sex === s} onClick={() => setSex(s)}>
                      {s === 'L' ? 'Laki-laki' : 'Perempuan'}
                    </FilterChip>
                  ))}
                </div>
              </div>
            </div>
          </Demo>

          <Demo
            title="Status, label, dan chip"
            note="Status tidak pernah dibedakan hanya dengan warna. Chip kode memakai Mono."
          >
            <div className="flex flex-wrap gap-2">
              <StatusChip status="diperiksa">Diperiksa</StatusChip>
              <StatusChip status="menunggu">Menunggu</StatusChip>
              <StatusChip status="menunggu-hasil">Menunggu hasil</StatusChip>
              <StatusChip status="selesai">Selesai</StatusChip>
              <StatusChip status="dibatalkan">Dibatalkan</StatusChip>
              <StatusChip status="terkirim">Terkirim SATUSEHAT</StatusChip>
            </div>
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
            <span className="text-caption text-ink-500">Chip filter · {filters.length} dipilih</span>
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
          </Demo>

          <Demo title="Peringatan klinis (4 tingkat)">
            <Alert level="critical">Kalium 6,8 mmol/L. Wajib konfirmasi DPJP dalam 30 menit.</Alert>
            <Alert level="warning">Dosis amlodipin dinaikkan 5 → 10 mg.</Alert>
            <Alert level="info">SEP terbit otomatis dari rujukan FKTP.</Alert>
            <Alert level="success">Resume ditandatangani dan dikirim ke SATUSEHAT.</Alert>
          </Demo>

          <Demo title="Toggle" note="Status selalu tertulis di samping sakelar.">
            {[
              {
                id: 'tg-ss',
                label: 'Kirim otomatis ke SATUSEHAT',
                desc: 'Resource dikirim setelah entri final',
                on: satusehat,
                set: setSatusehat,
              },
              { id: 'tg-padat', label: 'Mode padat', desc: 'Baris tabel 36 px', on: dense, set: setDense },
            ].map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span id={t.id} className="font-medium">
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
                    'inline-flex h-11 cursor-pointer items-center gap-2 border-0 bg-transparent px-1 text-caption font-semibold',
                    t.on ? 'text-brand-700' : 'text-ink-500',
                  )}
                >
                  <span
                    className={cx(
                      'flex h-6 w-11 items-center rounded-full border p-0.5',
                      t.on
                        ? 'justify-end border-brand-600 bg-brand-600'
                        : 'justify-start border-line-strong bg-muted',
                    )}
                  >
                    <span className="size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,0.25)]" />
                  </span>
                  {t.on ? 'Aktif' : 'Nonaktif'}
                </button>
              </div>
            ))}
          </Demo>

          <Demo title="Tab">
            <Tabs
              label="Contoh tab rekam medis"
              value={tab}
              onChange={setTab}
              items={[
                {
                  id: 'cppt',
                  label: 'CPPT',
                  content:
                    'S: pusing dan tengkuk berat sejak 3 hari. O: TD 162/98 mmHg. A: hipertensi esensial (I10). P: amlodipin 10 mg.',
                },
                {
                  id: 'ttv',
                  label: 'Tanda vital',
                  content: 'TD 162/98 mmHg · nadi 88 x/menit · suhu 36,8 °C · SpO2 98% · BB 64 kg.',
                },
                {
                  id: 'resep',
                  label: 'Resep',
                  content:
                    'Amlodipin 10 mg, 1 x 1 tablet pagi, 30 hari. Telaah apoteker: tidak ada interaksi.',
                },
              ]}
            />
          </Demo>
        </div>

        <Demo
          title="Banner identitas pasien (wajib di setiap layar klinis)"
          note="Dua pengenal sesuai SKP 1. Alergi satu baris pandang dengan nama."
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

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Demo title="Tabel data" note="Angka rata kanan. Nilai abnormal: warna + teks flag.">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-caption text-ink-500">
                  <th className="py-2 font-semibold">Pemeriksaan</th>
                  <th className="py-2 text-right font-semibold">Hasil</th>
                  <th className="py-2 font-semibold">Satuan</th>
                  <th className="py-2 font-semibold">Rujukan</th>
                  <th className="py-2 font-semibold">Flag</th>
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
                      'border-b border-line-soft',
                      dense ? 'h-9' : 'h-11',
                      r.flag && 'bg-danger-bg/50',
                    )}
                  >
                    <td>{r.name}</td>
                    <td className={cx('text-right font-semibold', r.flag && 'text-danger')}>{r.value}</td>
                    <td className="text-ink-700">{r.unit}</td>
                    <td className="text-ink-700">{r.ref}</td>
                    <td>{r.flag ? <Chip tone="danger">{r.flag}</Chip> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Demo>
          <div className="grid gap-4">
            <KpiCard label="Kunjungan hari ini" value="312" hint="+8% dari rata-rata" tone="success" />
            <KpiCard label="Klaim pending" value="27" hint="5 lewat 14 hari" tone="warning" />
          </div>
        </div>
      </Section>
    </div>
  );
}
