# 08 · Desain UI "Pelangi Klinis"

Sistem desain resmi sejak 6 Okt 2026 (ADR-0091), menggantikan "Klinis Bersih".
Kanvas fondasi + 44 layar: https://claude.ai/artifact/SkzcCc4jNGv48usyiFF1p8 (halaman "Fondasi" dan "Pelangi · 44 layar").
Tata letak dan alur per layar: `design/mockups/*.dc.html` (read-only). Token kode: `packages/ui/src/theme.css`, `packages/ui/src/tokens.ts`.

## 1. Cara Claude Code memakai mockup

Setiap file `.dc.html` berisi:
1. **Markup** di dalam `<x-dc>`: tata letak, teks, gaya inline (sumber nilai spasi, warna, ukuran).
2. **Logika** di `<script type="text/x-dc">` (class `Component`): state awal, data contoh, handler interaksi, aturan gerbang (mis. tombol nonaktif sampai syarat terpenuhi).

Saat membangun layar: baca keduanya, lalu tulis ulang sebagai komponen React + Tailwind memakai token `packages/ui`. Hole `{{…}}` = nilai dari state/props. Data contoh di mockup menjadi data seed/fixture, bukan hard-code.
Mockup bukan spesifikasi API; field dan aturan bisnis mengikuti `04-data-model.md` dan alur di `09-rencana-fase.md`.

## 2. Token

### Rona (ramp 50–900, kelas Tailwind `bg-<rona>-<step>`)

| Rona | 600 | Peran |
|---|---|---|
| samudra | `#2C55C4` | aksi utama, tautan, fokus, front office, info |
| zamrud | `#1A7A58` | domain klinis; status sukses (700 `#176249`) |
| anggrek | `#6A3FCF` | domain penunjang (lab, radiologi, farmasi, OK) |
| toska | `#148280` | domain keuangan dan pembayaran |
| bougenvil | `#C82C6B` | domain manajemen dan back office |
| batu | `#65728A` | netral: teks, garis, permukaan; domain sistem |
| kunyit | `#B8670A` | **hanya** status peringatan |
| koral | `#C23221` | **hanya** status kritis/bahaya |

### Domain → aksen `brand-*`

`AppShell` memasang `data-domain` dari grup menu aktif. Di dalamnya kelas `brand-50…900` menjadi ramp rona domain.
Pemetaan: `fo` samudra, `kl` zamrud, `pj` anggrek, `ku` toska, `mj` bougenvil, `si` batu.
Grup menu dipetakan di `apps/web/src/lib/nav.ts` (`GROUP_DOMAIN`).
Komponen layar cukup memakai `brand-*` untuk aksen; jangan menulis hex rona domain langsung.

### Semantik (tidak ikut domain)

| Token | Nilai | Pemakaian |
|---|---|---|
| `ink-900` / `ink-700` / `ink-500` / `ink-400` | `#17202E` / `#3B4559` / `#4D5870` / `#65728A` | teks utama / sekunder / keterangan / redup |
| `line` / `line-strong` / `line-soft` | `#E5EAF1` / `#D2DAE5` / `#F1F4F8` | garis |
| `canvas` | `#F8FAFC` + cahaya radial samudra | latar halaman |
| `danger` | koral `#C23221` (latar `#FFF1EF`) | blokir, nilai kritis, gagal |
| `warning` | kunyit `#924E0D` (latar `#FFF8EB`) | perhatian, perlu tindakan |
| `success` | zamrud `#176249` (latar `#ECFAF4`) | selesai, lunas, cocok |
| `info` | samudra `#24449E` (latar `#EEF4FF`) | informasi |
| Triase 1–5 | merah, oranye, kuning, hijau, biru | papan IGD, selalu disertai angka/teks |

Chip status memakai pasangan 100/800 (mis. `bg-koral-100 text-koral-800`). Status tidak pernah hanya warna.

### Gradien, kaca, gerak

- **Gradien hanya satu rona, gelap → terang.**
  - Tombol utama, menu aktif, langkah aktif, dan garis domain: 800 → 600 (`bg-btn-primary`, `bg-nav-active`, `bg-domain-bar`).
  - Kotak peringatan: 50 → 100 (`bg-alert-warning|critical|info|success`).
  - KPI: 100 → 50.
  - Logo: `bg-fajar` (samudra).
  - Dilarang gradien lintas rona (merah → biru, hijau → ungu, dst.).
- **Kaca** (`glass`, `glass-soft`): jendela, sidebar, header, palet perintah. Bila `prefers-reduced-transparency`, kaca diganti permukaan padat.
- **Gerak.**
  - Jendela `animate-win-in`.
  - Isi halaman `stagger-rise`.
  - Palet `animate-pal-in`.
  - Sukses `animate-pop`.
  - KPI `shine-once`.
  - Denyut `animate-crit` hanya untuk status kritis.
  - Semua dimatikan oleh `prefers-reduced-motion`.

### Tipografi dan bentuk

- Poppins 400/500/600/700 untuk seluruh antarmuka, dengan angka tabular. Judul memakai tracking negatif (−0,015 em).
- IBM Plex Mono hanya untuk pengenal: RM, ICD, SEP, nomor resep, kode barang.
- Ukuran dasar 14 px desktop, 16 px mobile, ≥ 20 px anjungan.
- Radius: kontrol 11, kartu 16, jendela 20, chip 999. Bayangan kartu lembut (`shadow-card`); jendela `shadow-window`.

## 3. Komponen dasar (`packages/ui`)

`AppShell` (jendela kaca, `domain`/`domainLabel`, sidebar 236 px + header) · `Sidebar` (titik rona per grup, item aktif bergradien, grup terlipat bila > 24 layar yang bisa dibuka) · `CommandPalette` (⌘K / Ctrl K) · `PatientBanner` · `Button` (primary/secondary/danger/ghost) · `Field` · `Chip`/`StatusChip`/`FilterChip` · `Tabs` · `RadioSegmented` · `KpiCard`/`Card` · `Alert` (4 tingkat) · `SafetyGate` · `LineChart` · `Icon`.

## 4. Peta layar → rute → komponen

| Mockup | Rute web | Komponen katalog | Fase |
|---|---|---|---|
| Login | `/masuk` | P02 | 1 |
| Akses | `/sistem/akses` | P02, P03 | 1 |
| Audit | `/sistem/audit` | P04 | 1 |
| Formulir | `/sistem/formulir` | P07 | 1 |
| MPI | `/rekam-medis/mpi` | P05 | 1 |
| Registrasi | `/pendaftaran` | F03, F06 | 2 |
| Jadwal | `/jadwal` | F01 | 2 |
| Anjungan | `/kiosk` | F05 | 2 |
| DisplayAntrean | `/display/antrean` | F04 | 2 |
| Main (poli) | `/klinis/poli` | K01, K02 | 3 |
| IGD | `/klinis/igd` | K03 | 3 |
| BedManagement | `/klinis/tempat-tidur` | K05 | 3 |
| Ranap | `/klinis/rawat-inap/[encounterId]` | K04, K07, K12 | 3 |
| CPOE | `/klinis/order/[encounterId]` | K09 + CDS | 3 |
| Consent | `/tablet/persetujuan/[id]` | K11 | 3 |
| Resume | `/klinis/resume/[encounterId]` | K13 | 3 |
| Lab | `/penunjang/lab` | S01, S09 | 4 |
| Farmasi | `/penunjang/farmasi` | S04, S05 | 4 |
| OK | `/penunjang/kamar-operasi` | S06 | 4 |
| Kasir | `/keuangan/kasir` | U02, U03 | 5 |
| Klaim | `/keuangan/klaim` | U05, U06 | 5 |
| Akuntansi | `/keuangan/akuntansi` | U04, U07, U09 | 5 |
| PembayaranBTN | `/keuangan/pembayaran` | I05, U09 | 6 |
| PembiayaanBTN | `/keuangan/pembiayaan` | U04 | 6 |
| Integrasi | `/sistem/integrasi` | I01–I06 | 7 |
| Logistik | `/manajemen/logistik` | B01 | 8 |
| Dasbor | `/manajemen/dasbor` | I09 | 9 |
| AppPasien | `apps/mobile` (pasien) | I07 | 9 |
| AppDokter | `apps/mobile` (klinisi) | I08 | 9 |
| Simulasi | `/simulasi` (hanya non-produksi) + tes E2E | semua | 10 |
| Fondasi, Sidebar | `packages/ui` + halaman `/dev/ui` | — | 0 |

## 5. Aturan interaksi (dari mockup)

1. Gerbang keselamatan menahan aksi lanjutan sampai ditangani; override wajib alasan dan tercatat.
2. Tombol utama yang belum boleh dipakai tetap terlihat, tampil nonaktif, dan alasannya tertulis di dekatnya.
3. Setiap aksi penting memberi umpan balik berjam (mis. "Tervalidasi · 10.41").
4. Daftar kiri + detail kanan untuk worklist (lab, farmasi, klaim, transaksi).
5. Data yang dihimpun otomatis diberi label sumbernya ("dari eMAR", "dari CPPT").
6. Semua layar halaman bekerja di lebar tablet (≥ 768 px); sidebar runtuh menjadi menu atas di layar sempit.
