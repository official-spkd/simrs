# Serah-terima · PK-1

- Diperbarui: 7 Okt 2026 (Asia/Jakarta)
- Status: selesai (menunggu integrasi koordinator)
- Pemilik sesi: Claude Code (agen PK-1)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a983a140945cf0b00`
- Branch dan commit terakhir: `worktree-agent-a983a140945cf0b00` (lihat `git log --oneline master..`)
- Tujuan dan kriteria selesai: penyelarasan TAMPILAN layar front office + perangkat dengan papan Pelangi Klinis (ADR-0091; papan C01, C03, C04, C17–C22, C27, C41). Hanya gaya/tata letak; perilaku, state, Server Action, data demo, dan teks yang dipakai tes tidak berubah.
- Rencana/otorisasi pengguna: fase 2 Pelangi, lingkup front office + perangkat (rona samudra), arahan koordinator.
- Kepemilikan file/modul: `components/{front-office,info-publik,rujukan,pengalaman}/`, `app/(perangkat)/**`, `app/masuk/**`, `app/(staf)/{pendaftaran,antrean,jadwal,rujukan,simulasi}/`, `app/(staf)/page.tsx`. Satu file di luar daftar: `components/manajemen/phone-frame.tsx` (lihat di bawah).
- Sumber daya: DB tes `simrs_test_cd_a` (Postgres 127.0.0.1:5433), port API 4020, web 3020, demo 3021, mock 4120, folder sementara `simrs-demo-e2e-cda`.

## Sudah dikerjakan

Aturan yang diterapkan di semua layar lingkup:
- Kartu: `rounded-card border-white/95 bg-white/90 shadow-card`; kepala kartu `bg-card-header`.
- Judul halaman h1 22 px bold `tracking-[-0.02em]`; sub-judul ink-500.
- Stepper (pendaftaran, masuk, simulasi, tablet persetujuan): aktif `bg-btn-primary` + teks putih, selesai `zamrud-100/700`, belum `ink-900/5`.
- Chip status pasangan 100/800 (koral/kunyit/zamrud/samudra/batu).
- Bar kuota/progres `bg-domain-bar`; kotak peringatan/sukses/info/kritis `bg-alert-*` (50→100).
- Baris/daftar terpilih memakai gradien `brand-100 → putih/40`; hover `bg-brand-50/60`.
- Segmen (pilih penjamin, layanan antrean) memakai pola `.seg`: wadah `ink-900/6`, pilihan putih + `shadow-tab`.

Per layar:
- **Masuk** (`app/masuk/*`): panel kiri `bg-fajar` + cahaya putih lembut; logo putih ber-ikon samudra; langkah berupa pil; kartu langkah `shadow-card`; hex error OTP → `koral-400`; kotak persona `bg-alert-warning`.
- **Pendaftaran** (demo + api + selesai): stepper, kartu, chip header (VClaim, dilayani, antrean loket), segmen penjamin, kotak lembut `.soft`, hasil cek kepesertaan `bg-alert-success/critical`, pratinjau nomor antrean `brand-100→50`.
- **Kendali antrean**: segmen layanan, baris tiket berkaca + hover, `text-h3` (tidak ada di tema) → 15 px.
- **Jadwal dokter**: sel jadwal chip 100/800 (pengganti = garis putus samudra agar beda dari praktik), header grid 12 px ink-500, baris dokter terpilih bergradien, chip status HFIS kunyit/zamrud, detail slot dan form cuti berkaca.
- **Rujukan**: KPI `tinted`, item daftar terpilih bergradien.
- **Pengalaman pasien** (dipakai `manajemen/pengaduan`): baris tabel hover, kartu skor rendah.
- **Anjungan**: latar radial samudra (hapus `rgba(14,116,144…)` dan pola titik), opsi utama `bg-btn-primary` (hapus `#12807A`), opsi lain putih + `shadow-card`, logo `bg-fajar`, notifikasi `bg-alert-*`, tombol panggil petugas/primer satu rona. Target sentuh tidak diubah (≥ 64 px).
- **Display antrean** (demo + live): latar radial samudra (hapus `#F3F6F8`), header kaca, panel "Sedang dipanggil" gradien 800→600 (hapus `#12807A`), kartu poli berkaca, kaki `brand-900`, teks status `brand-200` (hapus `#B8C4CE`).
- **Tablet persetujuan** (daftar + dokumen): latar radial samudra, header/kaki kaca, langkah berupa pil, kartu tanda tangan berkaca, kotak status `bg-alert-*`, tombol tolak `bg-btn-danger`, chip status 100/800.
- **Aplikasi pasien / dokter / info publik (pratinjau)**: latar ponsel radial samudra, header tanpa blok putih, navigasi bawah melayang dengan pil aktif `brand-100`, kartu berkaca, tombol primer `bg-btn-primary`, kartu antrean `bg-btn-primary`, hex `#C27A1A` → `kunyit-600`, bar EWS rendah `zamrud-600`.
- **Simulasi**: kartu pasien `bg-card-header`, chip identitas 100/800, perjalanan pasien sesuai aturan stepper (langkah yang sedang dilihat = ring), tag jejak 100/800 (hapus `#E8EDF2`), ringkasan selesai `bg-alert-success`, menu lompat berkaca.
- **Beranda**: judul mengikuti skala h1.

`grep '#[0-9A-Fa-f]{6}'` di file lingkup: bersih (selain putih yang sudah hilang juga).

### Perubahan di luar daftar lingkup (catat untuk integrasi)
- `apps/web/src/components/manajemen/phone-frame.tsx`: latar bingkai ponsel menjadi radial samudra dan bilah status transparan. Komponen ini hanya dipakai pratinjau aplikasi pasien, aplikasi dokter, dan info publik (semua lingkup PK-1).

### Usulan untuk komponen bersama (tidak diubah)
- `ScreenHeader` (`components/platform/parts.tsx`, dipakai Rujukan) masih memakai gaya judul lama; selaraskan oleh pemilik `platform/parts`.
- `AppPageView` (`components/manajemen/app-page-view.tsx`) di pratinjau aplikasi belum diselaraskan (milik domain manajemen).
- Tema belum punya `text-h3`; satu-satunya pemakai di lingkup ini sudah diganti 15 px.

## Validasi

7 Okt 2026, setelah merge `origin/master` (ddc3397, perbaikan fondasi Pelangi):
- `turbo run typecheck lint test --filter=@simrs/web`: lolos (vitest 143 berkas, 969 tes).
- E2E terarah slot `cd_a` (pendaftaran, antrean, jadwal, kiosk, dod-anjungan, perangkat, demo/front-office, demo/fe1-platform, auth): **69 lolos, 6 dilewati (skip bawaan spec), 0 gagal**.
- Pemeriksaan CSS build: kelas baru (`bg-ink-900/6`, `bg-domain-bar`, `bg-fajar`, `bg-alert-*`, `ring-offset-canvas`, `disabled:bg-none`, dll.) ada di CSS hasil build.
- Belum dijalankan: E2E penuh semua spec; tinjauan visual tangkapan layar per layar.

## Kendala dan langkah berikutnya

- Worktree tidak memiliki `.env`; E2E dijalankan dengan skrip yang membaca `.env` checkout utama (hanya baca) lalu menyetel port/DB slot sendiri. Paket `packages/*` perlu `turbo run build` dulu di worktree baru (API butuh `@simrs/pdf/dist`).
- Tangkapan layar panduan (`docs/panduan/gambar/`) untuk layar front office perlu dibuat ulang (CD-5).

## Pengambilalihan

Agen PK-1 berhenti setelah laporan akhir; tidak ada proses yang berjalan.
