# ADR-0023 · Mode presentasi: layar fase 2–10 dibangun lebih dulu dengan data dummy

Status: diterima · 4 Okt 2026 · diperbarui 6 Okt 2026 · Komponen: lintas (P, F, K, S, U, B, I)

## Konteks
Pengguna perlu mempresentasikan seluruh layar SIM RS ke klien (RSCM) dan direksi sebelum backend fase 2–10 dibangun, dan ingin memantapkan UI/UX lebih dulu. docs/09 mensyaratkan fase berikut dimulai setelah DoD fase sebelumnya (backend + tes), dan docs/08 §1 meminta data contoh mockup menjadi fixture/seed, bukan hard-code. Pengguna memilih (4 Okt 2026): seluruh layar, **layar asli di rute finalnya + lapisan data dummy** yang kelak ditukar ke API, dan presentasi berupa panduan langkah + navigasi bebas memakai tiga skenario `design/mockups/Simulasi.dc.html`.

## Keputusan
1. **Pengecualian urutan fase.** Layar fase 2–10 boleh dibangun sebagai UI dengan data dummy sebelum DoD fase sebelumnya terpenuhi. Backend tiap fase tetap mengikuti DoD docs/09 saat disambungkan; layar tidak dianggap "selesai" untuk fase itu sebelum tersambung ke API.
2. **Gerbang gagal aman.** Data dummy hanya aktif bila `APP_ENV=local` **dan** `DATA_SOURCE=demo` (`webEnv().dataSource`); staging dan produksi selalu `api`. Setiap halaman ber-data dummy memanggil `requireDemoScreen()` (render dinamis, 404 di luar demo) dan setiap Server Action ber-data dummy memanggil `assertDemo()`, karena action ikut ter-build sebagai endpoint POST. Lencana "Mode presentasi · data fiktif" selalu tampil di header.
3. **Registri layar** `apps/web/src/lib/screens.ts`: status `belum` (menu redup), `demo` (hanya mode presentasi, per posisi), `api` (tersambung). Pembatasan per posisi di mode demo hanya di UI; izin sungguhan (`plannedPermission`) dibuat bersama backend.
4. **Kontrak dulu.** Skema respons zod per domain ditulis di `packages/shared/src/schemas/<domain>.ts` mengikuti entitas docs/04; data dummy divalidasi skema yang sama. Halaman dan action hanya mengambil data lewat `apps/web/src/lib/server/data/<domain>.ts`; jalur `api` berstatus belum diimplementasi sampai endpoint ada (tanpa menebak bentuk endpoint).
5. **Data dummy fiktif dan bisa ditelusuri.** Fixture di `apps/web/src/lib/demo/`: identitas jelas fiktif (NIK `9999…`, BPJS `0000…`), staf bernama fiktif, tanpa merek nyata, kode klinis hanya dari `SEED_REF_SAMPLES` (obat tanpa KFA di seed = "belum dipetakan"), uang `bigint` rupiah yang dihitung, bukan diketik. Web tidak boleh mengimpor `@simrs/db` di kode runtime (aturan ESLint); silang-cek kode hanya di tes.
6. **Gerbang keselamatan tetap memblokir** di mode demo (CDS, nilai kritis, gelang eMAR, time-out OK, triase turun): override wajib alasan, seperti produksi.
7. **Keadaan skenario presentasi** disimpan di server per akun demo (bukan cookie: batas 4 KB dan tidak bisa dibagi antar-perangkat), dihitung ulang secara deterministik dari definisi skenario + urutan aksi.
8. **Aplikasi pasien/dokter** ditampilkan sebagai pratinjau web dalam bingkai ponsel (`/pratinjau/…`, khusus demo); aplikasi aslinya tetap Expo (`apps/mobile`, fase 9).
9. **Akun presentasi pilih-klik** (permintaan pengguna 4 Okt 2026). `pnpm db:akun-presentasi` (hanya `APP_ENV=local`) membuat 16 akun fiktif, satu per posisi (nama dibuat-buat, satu penugasan), dengan sandi acak dan faktor TOTP terkonfirmasi; kredensialnya ditulis ke `.local/demo-accounts.json` (diabaikan git). Di mode presentasi, layar masuk menampilkan daftar akun itu; klik = web menjalankan **login biasa** di server (sandi → kode TOTP dari rahasia lokal → sesi). API tidak diberi jalan pintas: kunci akun, batas laju, MFA, dan jejak audit `login` tetap berlaku. Kredensial tidak pernah dikirim ke browser dan tidak dibaca di luar mode presentasi. Tombol "Buka layar sebagai posisi" di panduan berpindah ke akun presentasi posisi itu bila akun aktif tidak memegangnya; semua akun presentasi berbagi satu keadaan simulasi per RS. `pnpm dev:demo` melonggarkan batas laju login lokal menjadi 60/menit.

## Konsekuensi
+ Klien dan direksi melihat seluruh alur lebih awal; umpan balik UI/UX masuk sebelum backend dibangun, sehingga perubahan lebih murah.
+ Tidak ada layar yang dibuang: saat backend sebuah domain jadi, status di registri diubah ke `api`, fixture dipindah ke seed, dan skema bersama menjadi kontrak uji API.
− Risiko salah kira data dummy sebagai fitur jadi: dicegah lencana tetap, gerbang env, dan status "belum tersambung" di PROGRESS.
− Kontrak dummy bisa menyimpang dari kebutuhan backend nyata: dimitigasi skema bersama di `packages/shared` yang dipakai API nanti.
− Berkas `.local/demo-accounts.json` memuat sandi dan rahasia TOTP akun presentasi lokal: siapa pun yang membaca berkas itu bisa masuk sebagai akun-akun tersebut di database lokal. Akun itu hanya ada di database pengembangan (data fiktif), CLI menolak berjalan di luar lokal, dan menjalankan ulang CLI mengganti semua kredensial.

## Pembaruan 6 Okt 2026 · semua fase front end dulu

Pemilik produk meminta seluruh fase (0–10) punya alur front end yang jelas dan bisa diklik, tanpa menghabiskan waktu di backend. Cakupan pengecualian urutan fase (keputusan 1) diperluas ke **semua komponen katalog docs/02 yang belum punya layar**, termasuk platform (P01, P06, P08, P10–P13), back office B02–B13, dan konektor I02–I12. Pekerjaan dibagi ke lima agen per domain di git worktree terpisah, ditambah agen dokumentasi, pemeriksa bug, dan keamanan.

Penyimpangan yang diterima sementara, dicatat sebagai utang di PROGRESS:

- **Tipe di web.** Tipe respons layar baru ditulis di `apps/web/src/lib/<domain>.ts`, bukan skema zod di `packages/shared` (keputusan 4). Alasannya agar lima agen paralel tidak bentrok di paket bersama. Skema dipindah ke `packages/shared` saat backend domain itu dibangun.
- **Aksi hanya di klien.** Sebagian layar baru menjalankan aksi hanya di keadaan klien, berlabel "(simulasi, tidak disimpan)", tanpa Server Action. Keadaannya hilang saat halaman dimuat ulang atau posisi berganti, dan tidak tercermin di layar lain. Keputusan 7 (keadaan skenario per akun di server) tetap berlaku untuk tiga skenario Simulasi.
- **Katalog belum lengkap.** Izin rencana (`plannedPermission`), peran baru, dan kode akun COA yang dipakai layar baru belum ada di katalog bersama. Semuanya ditambahkan bersama backend domainnya.

Gerbang env (keputusan 2) dan gerbang keselamatan (keputusan 6) berlaku sama untuk layar baru.

## Pembaruan 6 Okt 2026 · keputusan 10: posisi Superadmin demo

Pemilik produk meminta satu akun yang bisa membuka seluruh fitur seperti mockup. Keputusannya: **posisi demo "Superadmin demo" dengan semua akses**, hanya di mode presentasi.

10. **Superadmin demo · semua layar.** `pnpm db:akun-presentasi` (tetap hanya `APP_ENV=local`) juga membuat akun `presentasi.superadmin-demo` di RS fiktif yang sama. Di database dan API akun ini akun biasa dengan satu penugasan peran bawaan **`manajemen`** (hanya-baca, tanpa akses data pasien); tidak ada peran baru, izin baru, atau perubahan RBAC/ABAC, dan tidak bercampur dengan `superadmin_platform` (tenant PLATFORM, ADR-0013). Tanda `allAccess` hanya ditulis ke berkas kredensial lokal `.local/demo-accounts.json`.
    - **Pengenalan gagal aman.** `getSession()` web menerapkan posisi ini hanya bila `APP_ENV=local` DAN `DATA_SOURCE=demo`, nama pengguna + kode RS dari `/auth/me` (API, tidak bisa dipalsukan klien) sama dengan entri bertanda `allAccess` di berkas lokal, dan tenant berjenis RS. Di luar mode presentasi berkas tidak dibaca dan sesi tidak berubah; `screenOpen`/`navGroups` mengabaikan tanda di mode api.
    - **Semua layar tanpa ganti posisi.** Di mode presentasi `screenOpen`, menu, `requireDemoScreen`, dan Server Action demo menganggap posisi ini memegang semua `demoRoles`. Sidebar memuat seluruh grup, ditambah menu untuk layar registri tanpa menu sendiri (sub-layar RME, CPOE, resume, tablet persetujuan, anjungan, pratinjau aplikasi) dan **Panduan sistem**. Layar khusus api (Kendali antrean) tetap tertutup di mode presentasi.
    - **Bertindak sebagai.** Posisi yang ditampilkan di sesi (`role`) adalah posisi yang dibawakan di layar yang sedang dibuka: pilihan presenter di kontrol header **"Bertindak sebagai"** (cookie, divalidasi ke peran RS yang dikenal) bila layar memakai posisi itu, selain itu pemakai pertama layar (`demoRoles[0]`). Server Action dikirim ke URL halamannya, jadi halaman dan aksinya memakai posisi yang sama. Akibatnya gerbang posisi yang sudah ada tetap berlaku apa adanya (co-sign dan TTE hanya DPJP, triase, pemberian obat, pembuat ≠ penyetuju); gerbang keselamatan tidak dilemahkan dan override tetap wajib alasan. Izin API sesi tetap izin peran asli.
    - **Panduan.** `/superadmin/panduan` (dan gambarnya) terbuka untuk posisi ini hanya di mode presentasi (`canReadGuide`); `/dev/ui` dan status sistem tetap khusus operator platform.
    - Layar masuk menampilkan akun ini paling atas di "Masuk cepat · mode presentasi" berlabel **"Superadmin demo · semua layar"**; login tetap login biasa (sandi + TOTP oleh server). Tombol "Buka layar sebagai posisi" di panduan presenter tidak berpindah akun untuk posisi ini, cukup mengganti "Bertindak sebagai".

Konsekuensi: + presenter cukup satu akun untuk seluruh presentasi. − Satu akun memegang semua layar data dummy, jadi siapa pun yang membaca berkas kredensial lokal bisa membuka semua layar presentasi (data fiktif, hanya lokal; risiko sama dengan keputusan 9). − Posisi yang dibawakan ditentukan dari URL permintaan; aksi lintas layar yang dikirim dari halaman lain memakai posisi halaman pengirimnya.
