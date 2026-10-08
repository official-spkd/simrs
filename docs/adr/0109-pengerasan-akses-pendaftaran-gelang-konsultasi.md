# ADR-0109 · Pengerasan akses pasca review keamanan fase 3: pendaftaran tanpa isi klinis, kode gelang, konsultasi

Tanggal: 7 Oktober 2026 · Status: diterapkan (agen A1, sesudah potongan 3.9) · Keputusan orkestrator atas temuan
review keamanan fase 3 (`docs/05-keamanan.md` §6). Melengkapi ADR-0031 (ABAC unit/relasi), ADR-0059 (konsultasi),
ADR-0096 (gelang rawat inap), dan ADR-0104 (papan IGD/bed).

## Konteks

Review keamanan fase 3 (3.9) mencatat tiga temuan besar dan beberapa temuan kecil:

- `petugas_pendaftaran` memegang `clinical.read` (lingkup unit IGD) dan `triage.write` agar loket IGD bisa membuka
  papan IGD. Akibatnya loket juga bisa membaca CPPT, diagnosis, eMAR, dan ringkasan pasien IGD, serta menulis triase.
- `GET /encounters/:id/wristband` mengembalikan kode gelang (rahasia gerbang eMAR) ke setiap pemegang `bed.write`.
  Perawat bisa mengetik kode tanpa memindai gelang. Respons admisi juga memuat kode.
- Konsultasi: `changePrimary` boleh dipakai dokter mana pun yang berakses bila kunjungan belum punya DPJP utama aktif.
  Akses konsultan tetap berlaku sesudah konsul dijawab, ditolak, atau dialihkan ke penerima lain, dan sesudah DPJP
  utama berganti.
- Temuan kecil:
  - middleware unggah membaca body (hingga 10 MB) sebelum sesi diperiksa;
  - jumlah gambar tanda tangan per draf persetujuan tidak dibatasi;
  - catatan bebas permintaan bed tampil di papan bed umum;
  - papan IGD/bed untuk lingkup `relationship` belum disaring per pasien;
  - `GET /consults/consultants` cukup `clinical.write`.

## Keputusan

1. **Pendaftaran tanpa isi klinis.** `clinical.read` dan `triage.write` dicabut dari `petugas_pendaftaran`. Triase
   dikerjakan perawat atau dokter IGD. Loket IGD memakai **papan IGD administratif**:
   - endpoint `GET /triage/board/admission` dan `GET /triage/board/admission/events` (SSE), izin `encounter.read`;
   - bentuk respons sama dengan papan klinis, ditambah `view: 'administratif'`, dengan `triage` selalu null;
   - isinya identitas ringkas, penjamin, status alur dan zona, penempatan bed IGD, dokter penanggung jawab,
     permintaan bed, dan SEP IGD;
   - lingkup dan audit per pasien sama dengan papan klinis (`view: 'klinis'`);
   - layar IGD dibuka dengan `clinical.read` atau `encounter.write` (`ScreenDef.alsoPermissions`). Peran yang hanya
     memegang `encounter.read`, misalnya kasir, tidak mendapat menu IGD;
   - di papan administratif, lencana triase tertulis "Triase klinis" dan panel triase diganti keterangan bahwa triase
     hanya tampil untuk petugas klinis.

   Peran sistem yang belum diubah RS disamakan lewat `pnpm db:sync-permissions --reconcile`.
2. **Kode gelang hanya lewat aksi cetak.**
   - `GET /encounters/:id/wristband` mengembalikan gelang aktif tanpa kode (`WristbandStatus`, audit `read`).
   - Kode keluar hanya lewat `POST /encounters/:id/wristband/print` (audit `print`) dan
     `POST /encounters/:id/wristband/reprint` (beralasan; gelang lama batal, kode baru tercetak).
   - Izin cetak = `bed.write`, dipegang admisi dan perawat/bidan.
   - Respons admisi (`/adt/admissions`, `/registration/emergency-admissions`) tidak memuat kode.
   - Halaman cetak memuat identitas saja. Kode muncul setelah petugas menekan "Cetak gelang", lalu dialog cetak
     browser terbuka.
   - eMAR tidak pernah menerima kode: hasil pindai dikirim ke `POST /nursing/wristband-scans` dan dicocokkan dengan
     kode tersimpan di server.
3. **Konsultasi.**
   - `POST /encounters/:id/care-team/primary` hanya untuk DPJP utama aktif (dokter) atau **manajemen medis**, yaitu
     peran yang memegang `care_team.assign` (izin katalog baru; bawaan peran `manajemen` lingkup `all`, lihat
     pembaruan di bawah). DPJP utama memakai rute serah (`clinical.write`); manajemen memakai
     `POST /encounters/:id/care-team/primary/assignment` (`care_team.assign`). Alasan wajib dan audit mencatat
     `by: dpjp_utama | manajemen_medis`. Selain itu 403, termasuk bila belum ada DPJP utama.
   - Akses konsultan (relasi bersumber rantai permintaan konsul) berakhir saat itu juga bila:
     - konsul dijawab atau ditolak. Koreksi atau addendum jawaban membuka akses sementara lalu menutupnya lagi;
     - permintaan dikoreksi ke penerima lain. Hanya penerima lama yang dicabut;
     - DPJP utama berganti, lewat serah langsung atau alih rawat yang diterima. Akses konsultan semua rantai konsul
       kunjungan itu berakhir, dan anggota tim berperan `konsultan` diakhiri (`endedAt`).
   - Pengecualian: konsultan yang aktif sebagai rawat bersama (atau DPJP) tetap berakses lewat keanggotaan tim
     perawatannya.
   - Konsul yang belum dijawab tetap bisa dijawab penerimanya.
   - Keputusan ini menggantikan butir ADR-0059 "akses konsultan berakhir 24 jam setelah jawaban".
   - `GET /consults/consultants` memakai izin baru `consult.request` (dokter dan residen, lingkup `all`; daftar dokter
     bukan data pasien).
4. **Temuan kecil.**
   - Rute unggahan (`/patients/:id/documents`, `/consents/drafts/:id/signature-image`) memeriksa sesi (`sa1.` sah,
     aktif, MFA, tanpa wajib ganti sandi) **sebelum** body dibaca. Tanpa sesi sah, body dibuang tanpa ditampung
     lalu dijawab 401. AuthGuard tetap memvalidasi ulang.
   - Draf persetujuan menyimpan `signature_uploads` (migrasi `20261008700000`, CHECK 0–5).
     - Unggahan gambar tanda tangan ke-6 ditolak 409.
     - Ukuran per gambar ditegakkan di middleware dan service (`CONSENT_SIGNATURE_MAX_BYTES`, 512 KB).
   - Catatan bebas permintaan bed di papan bed hanya untuk peminta dan pelaku berelasi dengan pasien (relasi aktif
     atau akses darurat). Papan umum hanya menampilkan kelas, isolasi, dan status.
   - Lingkup `relationship` pada papan IGD dan papan bed:
     - hanya pasien berelasi yang tampil;
     - bed lain tetap tampil statusnya, tanpa kunjungan atau inisial.
5. **Fixture antrean E2E.**
   - Spesifikasi tidak pernah menulis `seq` tiket sendiri; nomor selalu dari `allocateQueueNumber`.
   - Global setup E2E (`support/queue.ts`) menaikkan urutan hari ini dan seterusnya ke nomor tiket terbesar yang
     sudah ada. DB slot yang dipakai ulang atau dipulihkan tidak lagi membuat API memberi nomor terpakai (409).
   - Global setup memperingatkan bila sisa nomor kurang dari 150.

## Konsekuensi

- RS yang sudah berjalan harus menjalankan `pnpm db:sync-permissions --reconcile`. Peran pendaftaran yang pernah
  diubah RS tidak disentuh. Selisihnya dicetak untuk ditinjau admin di layar Akses.
- Loket IGD tidak lagi melihat level triase. Prioritas klinis dibaca petugas klinis di papan klinis.
- Petugas yang mencetak gelang tetap melihat kodenya, karena kode tercetak di gelang. Setiap pencetakan diaudit
  `print` dan bisa ditinjau. Kode tidak muncul di respons baca mana pun.
- Konsultan yang ingin menindaklanjuti sesudah menjawab harus diminta ulang, atau diterima sebagai rawat bersama.
- Kunjungan yang DPJP utamanya berakhir di luar alur (mis. cuti) tidak macet: manajemen menetapkan DPJP utama baru,
  beralasan dan diaudit.

## Pembaruan 8 Oktober 2026 · Manajemen medis bawaan

Keputusan orkestrator: peran `manajemen` memegang `care_team.assign` lingkup `all` secara bawaan. Karena peran itu
tidak memegang `clinical.write`, penetapan memakai rute sendiri
`POST /encounters/:id/care-team/primary/assignment` (izin `care_team.assign`). Rute serah
`POST /encounters/:id/care-team/primary` tetap untuk DPJP utama aktif. Keduanya wajib beralasan dan diaudit. RS
berjalan menyesuaikan lewat `pnpm db:sync-permissions` (izin baru ditambahkan ke peran bawaan).
