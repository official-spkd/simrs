# Serah-terima · CD-3 · Front office + platform interaktif

- Diperbarui: Sel, 6 Okt 2026 · 16.10 WIB
- Status: **siap integrasi**
- Pemilik sesi: Claude Code (agen CD-3)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a22af1b82bf3bb896`
- Branch dan commit terakhir: `cd/cd-3` (lihat `git log -1 cd/cd-3`; basis `master` c6f3d04, master belum bergerak)
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §1 dan §6 CD-3.
- Rencana/otorisasi pengguna: tugas CD-3 dari CD-0 (front end mode presentasi saja; tanpa API backend, migrasi, dependensi baru).
- Kepemilikan file/modul: §2 baris "Front office + platform". Di luar milik sendiri hanya: 12 baris di `lib/demo/store/registry.ts` (satu per domain) dan bagian "Aliran front office dan platform (CD-3)" + satu kalimat di `docs/panduan/19-peta-kode.md` (diizinkan tugas).
- Sumber daya: DB `simrs_test_cd_b` (Postgres 127.0.0.1:5433), slot E2E 4030/3030/3031/4130, `E2E_TMP_NAME=simrs-demo-e2e-cdb`. Skrip env di scratchpad sesi (`cd3/env.sh`, `cd3/run-e2e.sh`), tanpa `.env`, kunci kolom acak lokal.

## Sudah dikerjakan

Dua belas domain toko demo (ADR-0085), satu baris registri masing-masing. Semua pelaku dari sesi (`ev.actor`); jam `HH.MM` di kejadian = jam hari demo layar (hanya tampilan, bukan gerbang).

| Domain        | Berkas                             | Layar                    | Server Action                                                            |
| ------------- | ---------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `pendaftaran` | `lib/front-office-pendaftaran.ts`  | Pendaftaran              | sendiri (`pendaftaran/actions-demo.ts`)                                  |
| `antrean`     | `lib/front-office-antrean.ts`      | Anjungan, Display, loket | sendiri (`kiosk/`, `display/antrean/`, `pendaftaran/` `actions-demo.ts`) |
| `jadwal`      | `lib/front-office-jadwal.ts`       | Jadwal dokter            | sendiri (`jadwal/actions-demo.ts`)                                       |
| `pengaturan`  | `lib/platform-pengaturan-toko.ts`  | Pengaturan RS            | generik                                                                  |
| `struktur`    | `lib/platform-struktur-toko.ts`    | Struktur RS              | generik                                                                  |
| `terminologi` | `lib/platform-terminologi-toko.ts` | Data rujukan             | generik (uji kering diulang di reducer)                                  |
| `dokumen`     | `lib/platform-dokumen-toko.ts`     | Dokumen & TTE            | generik                                                                  |
| `penjadwal`   | `lib/platform-penjadwal-toko.ts`   | Penjadwal pekerjaan      | generik                                                                  |
| `rujukan`     | `lib/rujukan-toko.ts`              | Rujukan                  | generik                                                                  |
| `downtime`    | `lib/operasional-downtime-toko.ts` | Mode downtime (+ banner) | generik                                                                  |
| `cadangan`    | `lib/operasional-backup-toko.ts`   | Cadangan & pemulihan     | generik                                                                  |
| `golive`      | `lib/golive-toko.ts`               | Kesiapan go-live         | sendiri (`sistem/go-live/actions.ts`, revisi terkini)                    |

### Alur yang kini bertahan + mengalir

- **Anjungan → papan TV → loket → kunjungan → papan TV.** Tiket anjungan (nomor dihitung server, beridentitas, didahulukan dari walk-in) tampil di strip "Loket pendaftaran" papan TV tanpa muat ulang (`DemoPolling` 3 dtk). "Panggil berikutnya" di loket → papan "SEDANG DIPANGGIL A-0xx · Loket pendaftaran", formulir memuat pasien tiket. SEP → kunjungan (`kunjungan.terdaftar`) → kuota hari ini +1 (Jadwal, meja, info publik), nomor poli berikutnya maju, nomor baru di "Berikutnya" papan TV. Papan: "Panggil berikutnya" + panggilan otomatis 6 dtk (bawaan mati), keduanya tersimpan (`antrean.dipanggil`), tidak memanggil nomor cadangan (PD-027).
- **Jadwal:** kuota (tidak di bawah booking), cuti beralasan (cuti hari ini = dokter hilang dari kuota hari ini), setujui pengalihan pasien cuti, kirim HFIS (status per slot).
- **Anjungan "Panggil petugas"** → peringatan di meja pendaftaran → "Tandai ditangani".
- **Info publik** membaca jadwal/kuota, papan poli, loket, dan rata-rata layanan (Pengaturan RS) dari toko; diperbarui berkala.
- **Downtime** aktif/pulih → `<DowntimeBanner />` (dipasang di Pendaftaran + Jadwal; layout lewat CD-0).
- **Pengaturan** modul aktif → `readActiveModules()` + `screenHiddenByModules()` untuk menu CD-0; template cetak berversi atas nama sesi.
- **Struktur, Data rujukan, Dokumen & TTE, Penjadwal, Rujukan, Cadangan, Go-live:** semua aksi tersimpan dengan riwayat "oleh <pengguna sesi>".

### Gerbang (pengguna sesi / "Bertindak sebagai")

- Satu kunjungan per pasien per hari; BPJS wajib SEP; kuota per penjamin; dokter cuti tidak bisa didaftarkan; nomor tiket/panggilan/antrean poli dihitung server.
- TTE hanya posisi **Dokter (DPJP)**, tercatat atas nama pengguna itu (bukan "Setujui sebagai dr. … (simulasi)").
- Keputusan go/no-go (dan buka kembali) hanya posisi **Manajemen**; GO terkunci sampai item kritis tersimpan selesai + berpemilik.
- Konfirmasi beralasan: cuti, nonaktif simpul, modul, template, batal dokumen/rujukan, jeda job, backup manual, aktivasi downtime, entri susulan.

### Kontrak kejadian keluar (rinci di `docs/panduan/19-peta-kode.md` → "Aliran front office dan platform (CD-3)")

- `pendaftaran` · `kunjungan.terdaftar` → Poli/worklist (CD-2) dan charge capture (CX-2): `visitId, patientId, rm, patientName, payer, poliCode, poliName, room, doctorId, doctorName, sessionId, queueNo, sepNo, diagnosis, ticketNo, jam, charge { itemCode: 'ADM-RJ', label, amount: '30000' }` (rupiah string digit → `BigInt`).
- `pendaftaran` · `sep.diterbitkan` → klaim/integrasi BPJS.
- `antrean` · `antrean.dipanggil` (`queueNo, poliCode, via`) → Poli (CD-2).
- `antrean` · `tiket.diambil` / `tiket.dipanggil` → command center (CX-3), farmasi (tiket `F-…`, CX-1).
- `jadwal` · `cuti.dicatat` / `kuota.diubah` → aplikasi pasien (CX-3).
- `struktur` · `simpul.dinonaktifkan` → papan tempat tidur (CD-2).

### Permintaan untuk CD-0

1. Pasang `<DowntimeBanner />` (`components/operasional/downtime-banner.tsx`, server component, `null` di mode api) di layout staf dan perangkat, di bawah lencana mode presentasi.
2. Sembunyikan menu modul mati: di `nav.ts`/sidebar mode presentasi, baca `readActiveModules()` (`lib/server/data/platform.ts`, `null` di mode api) lalu `screenHiddenByModules(screen, modules)` (`lib/platform-pengaturan-toko.ts`).
3. Opsional: Kendali antrean (`/antrean`) tetap `apiOnly` (404 di demo). Panggilan demo sudah ada di loket Pendaftaran dan papan TV; bila ingin layar Kendali demo, ubah registri lalu minta jalur demonya.
4. Panduan (CD-5): `docs/panduan/11-fitur-front-office.md` (Rujukan "Proses antrean kirim (simulasi)" → "(mock BPJS)", alur anjungan → loket, papan otomatis bawaan mati) dan `10-fitur-platform.md` (TTE oleh Dokter, go-live oleh Manajemen, aksi tersimpan).

### Sisa label "tidak disimpan" / keadaan klien (beralasan)

- Akses, Audit, MPI, Formulir: tidak punya jalur demo (langsung API fase 1), jadi tidak ada yang dimigrasikan.
- Cek kepesertaan BPJS, uji kering impor, pencarian kode, cek status booking publik (termasuk hitungan percobaan): kueri/baca, bukan aksi yang mengubah data.
- Pratinjau formulir di jalur api Formulir ("jawaban tidak disimpan") memang pratinjau.
- Pasien skenario (Tn. Suryo) tetap lewat mesin Simulasi (ADR-0085 keputusan 10).

## Validasi

- `pnpm --filter @simrs/web lint`, `typecheck` · lolos. `vitest` · 124 berkas, 881 tes lolos (baru: `lib/front-office-toko.test.ts`, `lib/platform-toko.test.ts`).
- E2E `demo-desktop`: `front-office.spec.ts` 7/7, `fe1-platform.spec.ts` 11/11 (cek bertahan setelah muat ulang di setiap layar + aliran anjungan → papan TV tanpa muat ulang, downtime → banner di posisi lain, TTE oleh Dokter, GO oleh Manajemen).
- Gerbang akhir (Sel, 6 Okt 2026 · 16.20; `master` = c6f3d04, tidak bergerak sejak basis, jadi tidak perlu digabung): `e2e/demo/{front-office,fe1-platform,superadmin-demo,semua-layar,toko-demo}.spec.ts` (`demo-desktop` + `demo-tablet`) bersama E2E api fase 2 `e2e/{kiosk,antrean,pendaftaran,jadwal,akses,audit,mpi,formulir}.spec.ts` (`desktop` + `tablet`) · **131 lolos, 0 gagal, 6 dilewati** (dilewati oleh spesifikasinya sendiri di proyek `tablet`).

## Kendala dan langkah berikutnya

- Kunci toko per proses web (ADR-0085). Panggilan otomatis papan TV menulis kejadian tiap 6 dtk saat dinyalakan; antrean terbatas, jadi berhenti sendiri saat kosong.

## Pengambilalihan

Agen CD-3 berhenti setelah laporan akhir; tidak ada server yang dibiarkan berjalan. Penerus: CD-0 (integrasi).
