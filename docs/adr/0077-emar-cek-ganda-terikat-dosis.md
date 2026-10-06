# ADR-0077 · eMAR: cek ganda terikat dosis dan sesi petugas kedua

Tanggal: 6 Oktober 2026 · Status: diterapkan pada potongan 3.5 (K12).

## Konteks

Skema II sudah menyimpan `double_check_user_id`, tetapi ID dari klien belum membuktikan bahwa perawat kedua memeriksa dosis. Pengaman eMAR harus berlaku juga saat dua permintaan dosis atau pembatalan order berbarengan.

## Keputusan

- Perawat/bidan kedua dengan izin `medication.administer` membuat atestasi melalui `POST /api/v1/nursing/double-checks` dari sesinya sendiri. Petugas tidak boleh memeriksa dosis dari pindaiannya sendiri.
- `medication_double_checks` menyimpan isi dosis beku, pindaian, petugas pemeriksa dan waktu server. Tabel memakai RLS FORCE, FK komposit bertenant, hak SELECT/INSERT dan trigger append-only yang juga berlaku bagi pemilik tabel.
- `doubleCheckId` mengikat pemberian ke atestasi tersebut. Target obat, jadwal, pindaian, label, waktu dan alasan harus cocok; ID petugas saja ditolak. Perubahan dosis memerlukan pemeriksaan baru.
- Gelang masih harus aktif dan pindaian harus cocok, milik pemberi obat, serta belum kedaluwarsa saat pencatatan. Cetak ulang membatalkan kegunaan pindaian lama.
- Pengiriman dosis memakai kunci transaksi per order yang sama dengan pembatalan CPOE. Encounter dikunci baca selama pemberian. Dosis terjadwal hanya boleh sekali; stat sekali per order; PRN berikutnya memerlukan pindaian baru.
- Keterlambatan dihitung dengan waktu server, dan dihitung ulang oleh trigger DB. `late=false` dari klien tidak menghindari alasan wajib.
- Selisih waktu klien sampai lima detik sebelum pindaian dinormalisasi ke waktu pindaian server; nilai yang lebih lama ditolak. Pencatatan dosis tetap terjadi setelah pindaian.
- Fase 3 memakai UUID baris order sebagai label obat lokal, termasuk racikan. Label farmasi fase 4 harus disambungkan di titik pemeriksaan label ini.
- Jadwal WIB dibentuk idempoten pada event `order.activated` untuk hari berjalan. Papan eMAR mengisi jadwal hari yang diminta dengan batas waktu order dan durasi; GET ini hanya menambah proyeksi jadwal lokal yang belum ada. PRN/stat tidak memiliki jam tetap.

## Konsekuensi

Ada satu tabel dan satu FK tambahan untuk bukti cek ganda. Rencana asuhan tetap memakai pola entri klinis berversi; balans cairan memakai `observations` kategori `cairan`. Pemberian membuat outbox SATUSEHAT `held`; hanya dosis `given` membuat biaya obat tanpa harga. Bila RS menyalakan gerbang telaah farmasi sebelum sambungan fase 4 tersedia, pemberian ditolak.

API K12 selesai sebelum sambungan layar W4. Bukti validasi dicatat di `docs/PROGRESS.md` dan `docs/handoff/fase-3-nursing.md`.
