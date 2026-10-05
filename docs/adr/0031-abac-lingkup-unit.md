# ADR-0031 · ABAC lingkup `unit`: kunjungan aktif di unit penugasan

Status: diterima · 5 Okt 2026 (bagian fase 2 potongan 7; tingkat kamar/bed menyusul fase 3) · Komponen: P03, F03, P05

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
