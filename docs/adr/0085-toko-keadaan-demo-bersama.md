# ADR-0085 · Toko keadaan demo bersama: log kejadian + reducer per domain

Status: diterima · 6 Okt 2026 · Komponen: lintas (contoh migrasi S01, S09, P09) · Tugas: CD-1 (`docs/13-pembagian-tugas-cd-cx.md` §6)

## Konteks

Pemilik produk meminta mode presentasi yang benar-benar interaktif (`docs/13` §1): aksi di layar mana pun bertahan setelah muat ulang, ganti posisi, dan di perangkat lain; hasilnya mengalir ke layar terkait; dan ada tombol "Mulai ulang data demo". Sebelumnya hampir semua layar demo hanya mengubah `useState` berlabel "(simulasi, tidak disimpan)" (ADR-0023, pembaruan 6 Okt). Satu-satunya keadaan server adalah toko skenario Simulasi (`lib/server/demo/store.ts`, ADR-0023 keputusan 7), yang khusus tiga skenario.

Batasnya tetap ADR-0023: hanya `APP_ENV=local` + `DATA_SOURCE=demo`, setiap Server Action `assertDemo()`, data fiktif, tanpa API backend baru, tanpa migrasi, tanpa dependensi baru. Lima agen akan memigrasikan domainnya secara paralel, jadi polanya harus kecil, tipe-aman, dan tidak membuat domain saling mengimpor komponen.

## Keputusan

1. **Log kejadian + reducer murni per domain.** Keadaan domain = `initial()` (fixture awal) + kejadian di log, diputar ulang berurutan (`project()`, `lib/demo/store/define.ts`). Yang disimpan hanya kejadian, bukan keadaan, sehingga fixture yang berubah langsung berlaku dan mulai ulang cukup mengosongkan log. Kejadian yang tidak lolos skema atau ditolak reducer dilewati saat diputar ulang (toko tetap terpakai setelah definisi berubah).
2. **API tipe-aman.**
   - `defineDomain(name, { initial, eventSchema, reduce, screens, subscriptions?, validate?, generic? })`. `eventSchema` zod (union berdiskriminan `type`), `screens` = id layar registri yang menampilkan domain.
   - `readDomain(name)` di server component/pengambil data → `{ state, rev }`.
   - `commitEvent(name, event, { rev })` dari Server Action domain, setelah gerbang domain memeriksa rekaman di server.
   - `dispatchDemoEventAction(name, event, rev)` = Server Action generik, hanya untuk domain `generic: true` (aturannya cukup skema + `validate` murni). Bawaan `false`: domain yang gerbangnya butuh data server (sampel, nilai kritis, stok) wajib lewat Server Action sendiri, agar klien tidak bisa melompati gerbang dengan mengirim kejadian langsung.
   - Klien: `useStoreAction(rev)` / `useDemoDispatch(name, rev)` (`lib/demo/store/client.ts`) membawa revisi terkini, memberi tahu tab lain (`announceDemoChange`), dan memuat ulang bila basi.
   - Registri nama → definisi: `lib/demo/store/registry.ts`. Pemilik domain menambah **satu baris** (urut abjad) yang mengimpor definisinya dari `lib/<domain>.ts` miliknya.
3. **Pelaku dari sesi.** Setiap kejadian menyimpan `actor` (id, nama tampilan, posisi yang dibawakan, penugasan asli bila Superadmin demo "Bertindak sebagai"). Pelaku tidak pernah diambil dari kiriman klien; reducer memakai `ev.actor` untuk "oleh …", pemisahan tugas, dan TTE atas nama pengguna.
4. **Langganan lintas domain.** `on(domainSumber, reducer)` di `subscriptions`: reducer domain pelanggan menerima kejadian sumber yang lolos skema sumbernya. Pelanggan hanya mengimpor definisi domain sumber (modul `lib`), bukan komponen layarnya. Revisi pelanggan ikut maju oleh kejadian sumber; `commitEvent` memuat ulang (`revalidatePath`) layar domain sumber dan semua pelanggannya.
5. **Berkas per ruang data, penulisan atomik.** `<DEMO_STATE_DIR>/toko/<RUANG>.json` (bawaan `.local/demo-state`, E2E: folder `E2E_TMP_NAME`). Perubahan diserialkan per ruang dalam satu proses web, ditulis ke berkas sementara lalu `rename`. Berkas hilang, rusak, atau milik ruang lain = kosong; kejadian dengan `seq` tidak naik dibuang.
6. **Ruang data** mengikuti aturan toko skenario (ADR-0023 keputusan 9): semua akun presentasi (`presentasi.*`, termasuk Superadmin demo) berbagi **satu ruang per RS**, sehingga aksi terlihat lintas posisi dan perangkat. Akun lain (akun uji, akun pengembang) punya ruang sendiri (`<RS>-<id pengguna>`), agar E2E paralel tidak saling mengganggu.
7. **Revisi menolak tampilan basi.** `seq` global per ruang naik terus (juga melewati mulai ulang). Revisi domain = `seq` kejadian relevan terakhir (atau mulai ulang terakhir). Aksi membawa revisi yang dilihat layar; bila berbeda dari revisi terkini di dalam kunci ruang, aksi ditolak sebagai basi dan layar dimuat ulang. Karena pemeriksaan ini di dalam kunci, gerbang yang dibaca Server Action sebelum kunci tetap sah.
8. **Batas ukuran.** 5.000 kejadian, 16 KB per kejadian, 4 MB per berkas (UTF-8). Toko penuh menolak aksi berikutnya dengan pesan untuk memulai ulang.
9. **"Mulai ulang data demo"** ada di lencana "Mode presentasi · data fiktif" (`components/demo-data-menu.tsx`): ringkasan jumlah aksi + mulai ulang terakhir, dan tombol berkonfirmasi untuk posisi admin SIM RS, manajemen, atau Superadmin demo (`canResetDemoData`, diperiksa ulang di Server Action). Mulai ulang mengosongkan log ruang itu dan mencatat pelaku + jam.
10. **Skenario Simulasi tetap terpisah.** Tiga skenario tetap di toko skenario (urutan aksi presenter, `scenarioRuns`) dengan mulai ulang sendiri di layar Simulasi. Layar memakai keduanya: pasien skenario diproyeksikan dari mesin skenario, aksi layar untuk data fixture lain disimpan di toko bersama. Contoh: nilai kritis pasien skenario IGD tetap dilaporkan lewat tugas skenario; Server Action toko menolak pasien skenario.
11. **Contoh migrasi: pelaporan nilai kritis.** Domain `hasil-kritis` (`lib/penunjang-kritis.ts`): kejadian `laporan.dicatat` dari layar Laboratorium dan Pusat hasil kritis. Pengambil data menerapkan keadaan toko ke fixture (`getLabWorklist`, `getCriticalCenter`), jadi kedua layar dan Server Action membaca sumber yang sama. Saat read-back dihitung server dari waktu terbit + timer layar yang dibatasi (tidak lebih awal dari saat data dibuka, maksimal 12 jam sesudahnya); timer hanya memengaruhi angka durasi demo, bukan gerbang.

## Konsekuensi

- \+ Satu pola untuk semua domain: aksi bertahan, mengalir lewat langganan, dan bisa diulang dengan satu tombol, tanpa backend.
- \+ Bentuk kejadian (zod) menjadi draf kontrak event domain backend kelak (`docs/01-arsitektur.md` §2), sesuai ADR-0023 keputusan 4.
- − Log diputar ulang di setiap render (dibatasi 5.000 kejadian; satu kali per permintaan berkat React `cache`). Cukup untuk presentasi, bukan pola produksi.
- − Kunci hanya dalam satu proses web. `next start` tunggal (lokal dan E2E) aman; beberapa proses yang menulis ruang yang sama bisa kehilangan tulisan (sama dengan toko skenario).
- − Revisi per domain menolak aksi bila domain itu (atau sumber langganannya) berubah di tab lain walau rekamannya berbeda. Tab yang sama tersinkron otomatis lewat `BroadcastChannel`; perangkat lain cukup mengulang aksi setelah tampilan dimuat ulang.
- − Registri adalah satu berkas bersama. Konflik gabung hanya terjadi pada baris yang berdampingan dan mudah diselesaikan.
- − Akun pengembang non-presentasi melihat ruang datanya sendiri, bukan ruang presentasi RS. Untuk presentasi, gunakan akun presentasi (masuk cepat).
