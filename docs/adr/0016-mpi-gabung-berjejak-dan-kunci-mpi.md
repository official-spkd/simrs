# ADR-0016 · Penggabungan rekam medis berjejak tanpa memindah data, dan kunci MPI per RS

Status: diterima · 4 Okt 2026

## Konteks
Definisi selesai fase 1: "Merge MPI tidak menghapus apa pun dan bisa ditelusuri". Mockup MPI menunjukkan antrean kemungkinan rekam medis ganda, banding atribut dengan pilihan sumber per atribut, keputusan beralasan, dan pembatalan dalam 30 hari. Rekam medis klinis (fase 3) bersifat immutable (ADR-0004), jadi memindahkan baris klinis dari B ke A (UPDATE `patient_id`) bertentangan dengan prinsip itu dan menyulitkan pembatalan. Saat diuji, dua penggabungan serentak atas pasangan yang saling mirip berakhir deadlock (`[500, 500, 200]`, penghitung deadlock Postgres naik).

## Keputusan
1. **Gabung = penanda, bukan pemindahan.** B diberi `status = merged` + `merged_into_id = A`; semua data B (identifier, relasi, kelak kunjungan dan entri klinis) tetap pada B. Satu orang = kelompok rekam medis `app_patient_group(id)` (akar aktif + semua yang digabung ke dalamnya, berjenjang). Akses relasi/akses darurat ke salah satu rekam medis berlaku untuk seluruh kelompok; modul klinis kelak membaca riwayat lewat kelompok ini.
2. **Atribut pilihan dari B menimpa A, nilai lama A disimpan.** `patient_links` mencatat alasan, pelaku, waktu, nama atribut yang diambil, dan snapshot nilai A sebelum ditimpa (JSON terenkripsi, tujuan `patient_snapshot`). Identifier B disalin ke A sebagai baris baru; identifier lama A dinonaktifkan beralasan, tidak dihapus.
3. **Batal ≤ 30 hari.** B aktif kembali; atribut A yang masih bernilai sama dengan B dipulihkan dari snapshot, sedangkan atribut yang sudah diubah petugas sesudahnya dibiarkan dan dilaporkan (`kept`). Jejak gabung tetap ada (kolom `undone_*`); pasangan kembali ke antrean. Lewat 30 hari: koreksi lewat prosedur rekam medis, bukan tombol.
4. **Antrean dari deteksi otomatis.** Setiap daftar/ubah identitas menjalankan `detectDuplicates`: pra-saring murah di SQL (identifier/no. HP sama, tanggal lahir sama, nama sangat mirip), skor lengkap di aplikasi (`scorePatientMatch`, butuh nilai terdekripsi untuk NIK salah ketik dan alamat). Skor 0–99, ambang 40; alasan berupa kode tanpa PHI. Keputusan "bukan orang yang sama" tidak diusulkan ulang.
5. **Kunci MPI per RS.** Semua alur yang menulis antrean (daftar, ubah identitas, gabung, batal, keputusan, deteksi) mengambil `lockMpi` (advisory lock tenant) **sebelum** mengunci baris pasien atau kandidat. Urutan kunci menjadi seragam sehingga deadlock hilang (dibuktikan tes: tiga ronde × tiga penggabungan serentak, penghitung deadlock tetap 0). Penulisan audit sudah berurutan per tenant, jadi throughput praktis tidak berubah.
6. **Data tak terbaca tidak menggagalkan pendaftaran.** Nilai yang gagal didekripsi (kunci salah, data rusak) dianggap kosong saat deteksi dan dicatat sebagai peringatan berisi ID internal.

## Konsekuensi
+ Tidak ada data yang dihapus atau dipindah; setiap keputusan (gabung, batal, bukan orang yang sama, buka ulang) tercatat di audit kedua pasien dan di `patient_links`/`patient_match_candidates`.
+ Pembatalan aman karena tidak ada data klinis yang perlu dikembalikan.
− Query riwayat pasien di fase 2–3 wajib memakai kelompok rekam medis, bukan `patient_id` tunggal.
− Pendaftaran dan keputusan MPI dalam satu RS berjalan berurutan pada titik kunci MPI.
− Pasangan yang tidak terdeteksi otomatis (mis. pasien IGD tanpa identitas yang dikenali keluarga) belum bisa diusulkan manual (utang teknis).
− Sinkronisasi penggabungan ke SATUSEHAT (Patient link) menyusul bersama konektor SATUSEHAT (fase 7).
