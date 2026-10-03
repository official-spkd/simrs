# 08 · Desain UI "Klinis Bersih"

Kanvas interaktif: https://claude.ai/artifact/68mwSh34uMk31GWyNDJfHj
Salinan sumber tiap layar: `design/mockups/*.dc.html` · token: `design/tokens.json`, `design/tokens.css`.

## 1. Cara Claude Code memakai mockup

Setiap file `.dc.html` berisi:
1. **Markup** di dalam `<x-dc>`: tata letak, teks, gaya inline (sumber nilai spasi, warna, ukuran).
2. **Logika** di `<script type="text/x-dc">` (class `Component`): state awal, data contoh, handler interaksi, aturan gerbang (mis. tombol nonaktif sampai syarat terpenuhi).

Saat membangun layar: baca keduanya, lalu tulis ulang sebagai komponen React + Tailwind memakai token `packages/ui`. Hole `{{…}}` = nilai dari state/props. Data contoh di mockup menjadi data seed/fixture, bukan hard-code.
Mockup bukan spesifikasi API; field dan aturan bisnis mengikuti `04-data-model.md` dan alur di `09-rencana-fase.md`.

## 2. Token

| Token | Nilai | Pemakaian |
|---|---|---|
| `brand-600` | `#0F766E` | aksi utama, tautan, fokus |
| `brand-700` | `#0B5D56` | teks aksen, hover |
| `brand-100` | `#D5ECE7` | border lembut |
| `brand-50` | `#E6F4F1` | latar chip/terpilih |
| `ink-900` | `#14212B` | teks utama |
| `ink-700` | `#3F4C58` | teks sekunder |
| `ink-500` | `#5B6B79` | teks keterangan (min. 12,5 px) |
| `line` | `#E3E8EE` | border |
| `canvas` | `#F5F7F9` | latar halaman |
| `danger` | `#B42318` (latar `#FDECEA`) | blokir, nilai kritis, gagal |
| `warning` | `#8A4B00` (latar `#FFF3E0`) | perhatian, perlu tindakan |
| `success` | `#1E6B34` (latar `#EAF5EC`) | selesai, lunas, cocok |
| `info` | `#1E3A8A` (latar `#EEF2FB`) | informasi, BPJS |
| Triase 1–5 | merah, oranye, kuning, hijau, biru (lihat `tokens.json`) | papan IGD, selalu disertai angka/teks |

Tipografi: IBM Plex Sans (UI), IBM Plex Mono (angka, kode, nomor). Ukuran dasar 14 px desktop, 16 px mobile, ≥ 20 px anjungan.
Radius: tombol/input 10, kartu 14, chip 999. Latar: dot halus 22 px + radial teal sangat tipis di kanan atas. Gradien hanya singkat (tombol utama, kepala kartu), tidak pernah di area teks panjang.

## 3. Komponen dasar (`packages/ui`)

`AppShell` (sidebar 240 px + header) · `Sidebar` (grup menu sesuai `design/mockups/Sidebar.dc.html`) · `PatientBanner` · `Button` (primary/secondary/danger/ghost) · `Field` (label, bantuan, galat) · `Chip`/`StatusChip` · `Tabs` · `Segmented` · `DataTable` (sticky header, paginasi kursor) · `KpiCard` · `Alert` (4 tingkat) · `SafetyGate` (alarm + alasan override) · `Stepper` · `Timeline` · `Drawer` · `ConfirmDialog` · `SignaturePad` · `Keypad` (anjungan) · `EmptyState` · `Skeleton`.

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
