# ADR-0031 · ABAC lingkup `unit`: kunjungan aktif di unit penugasan

Status: diterima · 5 Okt 2026 (bagian fase 2 potongan 7) · diperbarui 6 Okt 2026 (fase 3: tingkat bed, tim perawatan, pasien rahasia) · Komponen: P03, F03, P05

## Konteks

Matriks izin punya tiga lingkup: `all`, `unit`, `relationship` (ADR-0012). Sampai fase 1 lingkup `unit` diperlakukan sama dengan `relationship`, karena belum ada data tempat pasien berada. Fase 2 potongan 7 membawa kunjungan IGD dan admisi rawat inap, sehingga "pasien sedang dilayani di unit mana" kini tercatat di `encounters.unit_id` + status. Rencana fase 2 (§2 potongan 7, §5) menetapkan: lingkup unit = encounter aktif di unit penugasan; tingkat bed di fase 3. Nomor ADR ini dipesan fase 3 untuk ABAC unit, jadi keputusan bagian fase 2 dicatat di sini dan fase 3 menambah bagian pembaruan.

Kebutuhan nyatanya: perawat IGD harus bisa membuka pasien IGD (termasuk "Tn. X" tanpa identitas) yang belum punya DPJP atau relasi apa pun; perawat bangsal tidak boleh membuka pasien IGD hanya karena berperan perawat.

## Keputusan

1. **Arti lingkup `unit`.** Pelaku berlingkup `unit` boleh membuka pasien bila ada kunjungan **aktif** (`planned`, `arrived`, `in_progress`, konstanta `ACTIVE_ENCOUNTER_STATUSES`) milik pasien itu (atau rekam medis lain milik orang yang sama, `app_patient_group`) yang `unit_id`-nya = unit penugasan sesi (`staff_assignments.unit_id` yang dipilih saat masuk). Lingkup `unit` mencakup semua dasar lingkup `relationship` (relasi aktif, akses darurat), sesuai urutan `all ⊃ unit ⊃ relationship`.
2. **Satu sumber aturan.** `PatientAccessService.basis()` (pemeriksaan satu pasien, dasar `'unit'` baru) dan `patientAccessSql()` (predikat SQL untuk pencarian MPI dan daftar kunjungan, disaring sebelum `LIMIT`) memakai syarat yang sama. Repository lain tidak menulis ulang syaratnya.
3. **Kunjungan selesai atau batal menutup akses unit.** Tidak ada masa tenggang di fase 2; dokumentasi susulan memakai relasi (DPJP berlaku sampai akhir hari berikutnya) atau akses darurat.
4. **Daftar kunjungan.** `GET /registration/encounters` untuk lingkup `unit` dipaksa ke unit penugasan; meminta unit lain = 403 diaudit (`access_denied`). Penugasan tanpa unit = tidak ada akses unit.
5. **Matriks bawaan tidak diubah.** Matriks bawaan rencana fase 2 §0a tetap (klinisi `encounter.read` lingkup `relationship`). RS yang ingin perawat IGD/bangsal membuka pasien di unitnya mengubah lingkup di layar Akses (diaudit). Perubahan bawaan klinisi ke lingkup unit diputuskan di fase 3 bersama `app_patient_location`.
6. **Penolakan** tetap `AuditedDenial` (audit `access_denied` dengan pasien dan `scope: 'unit'`), pesan mengarahkan ke akses darurat.

## Konsekuensi

- Perawat IGD yang diberi lingkup `unit` langsung bisa merawat pasien tanpa identitas; perawat bangsal mendapat akses saat admisi `planned` ke bangsalnya dibuat, dan kehilangan akses unit IGD saat kunjungan IGD selesai/batal.
- Pencarian MPI berlingkup unit hanya menemukan pasien yang sedang ada di unitnya.
- Belum ada lokasi kamar/bed: seluruh bangsal = satu unit. Fase 3 (bed, transfer, `app_patient_location`) mempersempit/menggeser akses saat pasien dipindah dan menambah tes "transfer memindah akses".
- Biaya query: satu `EXISTS` tambahan per pasien pada indeks `(tenant_id, patient_id)` dan `(tenant_id, unit_id, status)` yang sudah ada.

## Pembaruan 6 Okt 2026 · fase 3: tingkat bed, tim perawatan, pasien rahasia

Potongan 3.1 menyelesaikan bagian yang dipesan fase 3:

1. **Lingkup `unit` = lokasi kini pasien.**
   - `PatientAccessService.basis()` dan `patientAccessSql()` membaca `app_patient_location(pasien)`. Fungsi ini
     mengembalikan kunjungan aktif kelompok rekam medis, beserta unit bed yang sedang ditempati (`bed_assignments`
     terbuka), atau unit kunjungan bila belum ada bed.
   - Transfer bed ke unit lain memindah akses: perawat unit asal mendapat 403 (diaudit `access_denied`), perawat unit
     tujuan mendapat akses. Dibuktikan tes API `clinical-infra.test.ts`.
2. **Relasi dari tim perawatan.**
   - `CareTeamService.add()` menulis `encounter_participants` dan `access_relationships` di transaksi yang sama.
     Relasi bersumber `encounter_participant` + id, dengan pemetaan jenis: DPJP utama → `dpjp`, rawat bersama,
     konsultan, perawat penanggung jawab → `perawat_penanggung_jawab`.
   - `end()` menutup keanggotaan sekali, dan relasinya berlaku sampai akhir hari berikutnya (WIB) untuk dokumentasi
     susulan, sesuai butir 3.
3. **Pasien rahasia (EP 10c).**
   - Setiap baca/cari/cetak/ekspor rekam medis pasien `confidential` (termasuk rekam medis lain milik orang yang sama)
     menjadi temuan audit jenis `confidential`, tanpa ambang dan berkeparahan tinggi. Temuan ini tampil di layar Audit
     dan ikut ringkasan harian (versi ringkasan 2).
   - Pengetatan akses tetap di B09 fase 8 (keputusan fase 3 no. 21).
4. **Matriks bawaan.** Klinisi kini memegang izin `clinical.*` berlingkup `unit` (rencana §3.0a).
   - `patient.read` dan `encounter.read` bawaan tetap `relationship`; RS bisa mengubahnya di layar Akses.
   - Petugas pendaftaran mendapat `clinical.read` lingkup unit untuk papan IGD.
