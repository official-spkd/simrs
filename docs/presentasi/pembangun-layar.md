# Membangun layar mode presentasi (ADR-0023)

Panduan untuk siapa pun (pengembang atau agen) yang membangun layar fase 2–10 dengan **data dummy** sebelum
backend ada. Baca juga `docs/adr/0023-mode-presentasi-ui-dulu-dengan-data-dummy.md`, `CLAUDE.md`, dan
`docs/08-desain-ui.md`. Contoh lengkap yang sudah jadi: **Dasbor direksi** (`apps/web/src/app/(staf)/manajemen/dasbor/`)
dan **Simulasi** (`apps/web/src/app/(staf)/simulasi/`).

## 1. Prinsip

- Layar dibangun di **rute finalnya** (docs/08 §4) dari mockup `design/mockups/<Layar>.dc.html` (baca markup +
  blok `<script type="text/x-dc">` untuk tata letak, data contoh, dan aturan gerbang). Implementasi ulang dengan React +
  Tailwind token, jangan menyalin runtime mockup. Layar harus terasa seperti produk jadi.
- Mode presentasi hanya hidup bila `APP_ENV=local` **dan** `DATA_SOURCE=demo`. Di luar itu halaman 404 dan action
  ditolak. Semua data **fiktif**.
- Teks UI Bahasa Indonesia. Angka rupiah `Rp 1.250.400` (`formatRupiah(bigint)`), tanggal `Sen, 5 Okt 2026 · 07.10`
  (`formatTanggalWaktu`, `formatJam` dari `@simrs/shared`). Hari demo tetap **Senin, 5 Okt 2026**
  (`DEMO_TODAY`, `DEMO_NOW` di `lib/demo/fixtures/waktu.ts`).
- Gerbang keselamatan (CDS, nilai kritis, gelang eMAR, time-out operasi, triase turun, override koding) **tetap
  memblokir** dan override wajib alasan: pakai `SafetyGate` dari `@simrs/ui`.
- Nama RS jangan di-hardcode: pakai `session.tenant.name`.

## 2. Berkas per layar

| Berkas                                         | Isi                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/web/src/app/(staf)/<rute>/page.tsx`      | Halaman server: gerbang demo, ambil data, susun tata letak                                 |
| `apps/web/src/app/(perangkat)/<rute>/page.tsx` | Layar penuh (anjungan, TV, tablet, pratinjau ponsel) dalam `ScaleToFit`                    |
| `…/<rute>/*-client.tsx`                        | Bagian interaktif (`'use client'`), state lokal, panggil Server Action                     |
| `…/<rute>/actions.ts`                          | Server Action layar (`'use server'`), selalu diawali `assertDemo()` + cek sesi             |
| `packages/shared/src/schemas/<domain>.ts`      | Kontrak respons zod (sudah ada berkas kosong per domain; ekspornya sudah terdaftar)        |
| `apps/web/src/lib/server/data/<domain>.ts`     | Satu-satunya pintu data halaman: demo → fixture + `schema.parse`, api → `notImplemented()` |
| `apps/web/src/lib/demo/fixtures/<domain>.ts`   | Data fiktif domain, memakai fixture bersama di bawah                                       |
| `apps/web/src/lib/<domain>.ts` + `.test.ts`    | Fungsi murni tampilan (format, hitung total, filter) + tes unit                            |
| `apps/web/e2e/demo/<domain>.spec.ts`           | Tes Playwright mode presentasi                                                             |

Status layar di `apps/web/src/lib/screens.ts`: ubah `status: 'belum'` → `'demo'` untuk layar yang Anda bangun.

## 3. Kerangka halaman

```tsx
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { getLabWorklist } from '@/lib/server/data/penunjang';

export const metadata: Metadata = { title: 'Laboratorium' };

export default async function LabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, screen, allowed } = await requireDemoScreen('lab'); // id di lib/screens.ts
  if (!allowed) return <DemoAccessDenied screen={screen} />; // posisi lain → ajakan ganti posisi
  const sp = await searchParams; // state UI di URL (?pilih=…, ?status=…)
  const data = await getLabWorklist(session /*, filter */);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Penunjang / Laboratorium</span>
          <h1 className="m-0 text-h1 font-semibold">Laboratorium</h1>
        </div>
      </header>
      <ScenarioBanner session={session} screen="lab" /> {/* tugas skenario yang dibawakan di layar ini */}
      {/* … tata letak mockup … */}
    </div>
  );
}
```

Layar perangkat: `app/(perangkat)/kiosk/page.tsx` → `requireDemoScreen('kiosk')`, lalu bungkus kanvas dengan
`<ScaleToFit width={1080} height={1920} label="Anjungan pendaftaran mandiri">…</ScaleToFit>` (`@/components/scale-to-fit`).
Layout `(perangkat)` sudah memeriksa sesi dan memberi tombol "Kembali ke SIM RS".

## 4. Pola data (kontrak → fixture → modul data)

```ts
// packages/shared/src/schemas/penunjang.ts
export const labWorklistItemSchema = z.strictObject({ id: z.string(), patientRm: z.string(), … });
// apps/web/src/lib/server/data/penunjang.ts
import 'server-only';
export async function getLabWorklist(session: SessionView): Promise<LabWorklist> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return labWorklistSchema.parse(await demoLabWorklist(session)); // fixture + proyeksi pasien skenario
  }
  return notImplemented('laboratorium');
}
```

Setelah mengubah `packages/shared`, bangun ulang: `pnpm --filter @simrs/shared build` (web memakai `dist`).

## 5. Fixture bersama (WAJIB dipakai, jangan membuat identitas baru yang bertentangan)

- `lib/demo/fixtures/pasien.ts` → `PASIEN` (20 pasien fiktif: RM, umur, alergi, penjamin, riwayat; tiga pertama pasien
  skenario), `patientById`, `patientByScenario`.
- `lib/demo/fixtures/staf.ts` → `STAF` (dokter skenario), `PERSONA` (nama akun presentasi per posisi),
  `DOKTER` (dokter per poli), `STAF_LAIN`.
- `lib/demo/fixtures/rs.ts` → `POLI` (kode PD/JT/SR/PR/AN/BD/OG, ruang), `queueNo('PD', 27)` = `PD-027`, `UNIT`
  (unit seed), `BANGSAL` (total kelas 260 bed, 214 terisi; ICU 11/12 — selaras Dasbor), `REKENING`.
- `lib/demo/fixtures/waktu.ts` → `DEMO_TODAY`, `DEMO_NOW`, `shiftDate`.

Identitas tampil tersamar: NIK `9999••••••••4521`, kartu BPJS `0000123•••890`. Jangan pakai nama staf/pasien nyata,
merek, atau perusahaan nyata (mis. ganti nama alat analyzer dengan "Analyzer hematologi"). Fasilitas rujukan memakai
nama generik fiktif (mis. "Puskesmas Sukamaju").

**Kode klinis hanya dari contoh seed** (`SEED_REF_SAMPLES`, `packages/db/src/seed-ref.ts`; tes memastikan):

- ICD-10: A41.9, A91, C18.9, E11.9, E78.5, E87.2, E87.5, I10, I20.0, I21.4, I63.9, J06.9, J13, J18.9, J96.0, K30, K80.2,
  M10.9, N17.9, N18.3, N18.5, O82.0, R50.9, R57.2, R57.9, S72.3, Z37.0, Z51.1, Z99.2
- ICD-9-CM: 00.17, 38.93, 39.95, 51.23, 66.39, 74.1, 79.35, 87.03, 88.56, 88.72, 88.76, 89.03, 89.52, 89.65, 93.90,
  96.71, 96.72, 99.18, 99.25, 99.55
- LOINC: 1988-5 CRP, 2345-7 glukosa sewaktu, 883-9 golongan darah, 2085-9 HDL, 4548-4 HbA1c, 718-7 hemoglobin,
  2823-3 kalium, 2075-0 klorida, 2093-3 kolesterol total, 2160-0 kreatinin, 13457-7 LDL, 6690-2 leukosit,
  2951-2 natrium, 10331-7 rhesus, 2571-8 trigliserida, 777-3 trombosit, 10839-9 troponin I, 3094-0 ureum
- KFA (obat): 93000387 klopidogrel 75 mg, 93000655 bisoprolol 2,5 mg, 93000914 atorvastatin 40 mg,
  93001152 omeprazol 40 mg inj, 93002210 enoksaparin 60 mg/0,6 mL (high alert). Obat lain: `kfa: null`, tampil
  "KFA belum dipetakan".

Uang dihitung sebagai `bigint` (`sumRupiah`) lalu dikirim sebagai string; total = jumlah baris (uji).

## 6. Pasien skenario di layar asli

Tiga skenario Simulasi (`lib/demo/skenario/*.ts`) adalah cerita presentasi. Layar asli harus **mencerminkan
kemajuan** pasien skenario dan, bila wajar, bisa **memajukannya**.

```ts
import { scenarioRuns, milestone, milestoneValue, stepReached } from '@/lib/server/demo/scenario-context';
const runs = await scenarioRuns(session); // { rev, active, results: { 'rawat-jalan': R, 'igd-ranap': R, 'elektif-btn': R } }
const rj = runs.results['rawat-jalan'];
if (milestone(rj, 'kedatangan', 'tiket')) {
  /* Tn. Suryo ada di antrean loket A-031 */
}
if (milestone(rj, 'pendaftaran', 'sep')) {
  /* SEP 0301R0011026V005102, antrean poli PD-027 */
}
rj.rec; // rekam medis terbentuk saat ini: penjamin, sep, antrean, ttv, dx, order, hasil, obat, tindakan, kontrol, klaim …
rj.charges; // baris tagihan (bigint) — sumber kebenaran tagihan pasien skenario di Kasir
```

- `<ScenarioBanner session screen="<id>" />` menampilkan tugas langkah aktif bila langkah itu dibawakan di layar ini
  (id layar langkah ada di definisi skenario). Wajib dipasang di setiap layar yang dipakai skenario.
- Integrasi lebih dalam (tombol asli layar memajukan skenario): ambil `here = scenariosHere(runs, '<id>')`, lalu di
  komponen klien `useDemoRunner(runs.rev).run({ type: 'task', step: here.step.index, task: '<idTugas>', value: true,
scenario: '<id skenario>' })` hanya bila tugas itu `enabled` di `here.step.tasks`. Selain itu tombol berperilaku lokal.
- Id langkah/tugas per skenario (lihat berkasnya untuk lengkap):
  - rawat-jalan: kedatangan(scan,bio,tiket) → pendaftaran(panggil,cek,sep) → asesmen-perawat(td,gds,jatuh) →
    pemeriksaan-dokter(panggil,dx,order) → laboratorium(sampling,hasil,validasi) → resep(terapi,cds,prb,tte) →
    farmasi(telaah,siap,serah) → kasir(final,tutup) → pasca(notif,kontrol,klaim)
  - igd-ranap: kedatangan(id,gelang) → triase(ttv,level,alasan,bed) → asesmen-dokter(ekg,orderset,awal) →
    nilai-kritis(hasil,lapor,readback) → tata-laksana(k,cds,dispo,consent) → admisi(bpjs,alok,sep,transfer) →
    rawat-inap(emar,h1,echo,pindah,akhir) → resume(resume,rekon,tte) → kasir(final,pulang) → klaim(utama,bukti,sekunder,kirim)
  - elektif-btn: admisi(cek,kelas,setuju,sep) → deposit(kanal,buat,bayar,webhook,dupe,none) → operasi(tilik,op,pulih) →
    pasca-operasi(emar,h2) → resume(resume,tte) → kasir(final,cara,tenor,ajukan,setuju,cair,qrisbayar,pulang) →
    rekonsiliasi(tarik,cocok,jurnal) → klaim(kode,kirim,layak) → pembiayaan(pool,ajukan,cair,bpjs)

Jangan mengubah definisi skenario atau mesin; bila perlu perubahan, laporkan.

## 7. Interaksi di luar skenario

Server Action demo: `'use server'`, `assertDemo()`, cek sesi lengkap (lihat `app/(staf)/simulasi/actions.ts`),
validasi input zod, **tidak menyimpan apa pun**; kembalikan umpan balik "Tersimpan · 07.42 (simulasi, tidak
disimpan)". State UI sederhana boleh di komponen klien (`useState`) atau URL. `sessionStorage` hanya untuk kenyamanan,
selalu dalam `try/catch`.

## 8. UI

Komponen `@simrs/ui`: `Card`, `KpiCard` (`hint`, `detail`, `tone`, `tinted`), `Button`, `Field`, `Alert`, `Chip`,
`StatusChip`, `FilterChip`, `PatientBanner` (wajib di layar klinis), `Segmented`, `Tabs`, `LineChart`, `SafetyGate`,
`Icon` (nama ikon di `packages/ui/src/icons.tsx`), `cx`. Komponen baru khusus domain dibuat di
`apps/web/src/components/<domain>/` (jangan mengubah `packages/ui/src/index.ts`). Token Tailwind: `bg-brand-600`,
`text-ink-700`, `border-line`, `rounded-card`, `rounded-control`, `bg-danger-bg`, dst. (`packages/ui/src/theme.css`).
Aksesibilitas: elemen interaktif asli, label terlihat, target sentuh ≥ 44 px (anjungan ≥ 64 px), status tidak hanya
warna, tidak ada scroll horizontal di 768 px. Pola daftar-detail: daftar kiri `flex-[999_1_560px]`, panel kanan
`flex-[1_1_340px] max-w-[440px]`, pilihan baris lewat `?pilih=<id>`.

## 9. Tes

- Unit (vitest, `src/**/*.test.ts`): fixture lolos skema `.strict()`, total = jumlah baris, kode ⊂ daftar seed di atas,
  proyeksi pasien skenario per milestone (pakai `runScenario` + `advanceTo`/`applyAction` dari `lib/demo/engine/run`).
- E2E (`e2e/demo/<domain>.spec.ts`, berjalan di server mode presentasi :3011): `createAccount({ roles: ['<peran>'] })`,
  `loginAs(page, akun, '<rute>')` (dari `../support/accounts`), periksa judul, isi utama, satu interaksi kunci, gerbang
  keselamatan menolak tanpa alasan, dan `document.documentElement.scrollWidth <= clientWidth` di tablet.

## 10. Selesai berarti

`pnpm --filter @simrs/web exec tsc --noEmit`, `pnpm --filter @simrs/web lint`, `pnpm --filter @simrs/web exec vitest run`,
dan Prettier hijau; status layar `demo` di registri; commit Conventional Commits (kode komponen di badan, diakhiri
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
