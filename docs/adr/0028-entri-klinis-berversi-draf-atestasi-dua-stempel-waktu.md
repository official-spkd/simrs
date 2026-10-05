# ADR-0028 · Entri klinis berversi: draf terpisah, atestasi, dua stempel waktu

Status: diterima · 6 Okt 2026 (fase 3 potongan 3.0b) · Komponen: K06, K07, K08, K10, K11, K12, K13 · Memperluas ADR-0004

## Konteks

ADR-0004 menetapkan rekam medis append-only dan berversi, dan ADR-0019 menerapkannya untuk isian formulir. Fase 3
membawa belasan jenis entri klinis sekaligus (observasi, diagnosis, prosedur, alergi, CPPT, serah terima, konsultasi,
persetujuan, resume). MRMIK 8a/8b menuntut identitas penulis dan waktu yang tidak bisa diubah, termasuk penanda entri
yang dicatat terlambat. Rencana fase 3 (§2, keputusan 1, 2, 4) juga meminta draf yang boleh diubah sebelum final,
co-sign residen oleh DPJP, dan kunci setelah TTE. Tanpa satu pola, setiap modul akan menulis ulang aturan versi
dengan celah berbeda.

## Keputusan

1. **Satu bentuk kolom untuk semua tabel klinis berversi:** `root_id`, `version`, `supersedes_id`, `addendum_of`,
   `status` (`final` | `entered_in_error`), `correction_reason`, `occurred_at`, `recorded_at`, `author_user_id`,
   `author_role`, plus `patient_id` dan `encounter_id` (FK komposit ber-tenant).
2. **Invarian dijaga database, bukan hanya kode.**
   - CHECK `<tabel>_version_chain`: versi 1 = akar tanpa pendahulu. Koreksi selalu menggantikan versi sebelumnya dengan
     alasan 10–500 karakter (= `SAFETY_REASON_MIN`). Salah entri selalu versi baru beralasan. Addendum adalah akar
     baru, tidak sekaligus koreksi.
   - Indeks unik parsial `<tabel>_supersedes_once`: satu pengganti per versi. Dari dua koreksi serentak, yang kedua
     ditolak dan API menjawab 409.
   - Trigger `app_clinical_guard` (BEFORE INSERT, SECURITY INVOKER) memeriksa pendahulu: ada, akar sama, versi + 1,
     pasien dan kunjungan sama. Addendum hanya boleh atas versi final terkini dengan pasien dan kunjungan sama
     (`RECORD_NOT_FINAL`).
   - `app_reject_mutation` menolak UPDATE/DELETE, juga bagi pemilik tabel. Hak aplikasi hanya SELECT/INSERT.
3. **Dua stempel waktu.** `occurred_at` diisi PPA. `recorded_at` selalu diisi trigger dengan jam server, apa pun
   kiriman aplikasi. CHECK menolak waktu kejadian lebih dari 5 menit di depan waktu catat. Entri terlambat (selisih
   melebihi `clinical.late_entry_hours`) dihitung saat dibaca (`isLateEntry`), tidak disimpan, sehingga perubahan
   pengaturan RS tidak menulis ulang riwayat.
4. **Kunci TTE lewat dokumen sumber.** `documents` mendapat `source_type` (nama tabel) + `source_id` (id versi). Versi
   yang dokumennya punya tanda tangan `pending` atau `signed` (dokumen tidak batal) tidak bisa digantikan
   (`RECORD_LOCKED`); perubahan hanya lewat addendum. Tanda tangan `failed` tidak mengunci, sehingga versi bisa
   dikoreksi lalu ditandatangani ulang. Kunci tidak disimpan di baris entri karena baris itu append-only.
5. **Draf terpisah dari rekam medis.** `clinical_drafts` (satu per penulis × kunjungan × jenis) boleh diubah dan
   dihapus. API membatasinya ke penulis; job P11 membersihkannya setelah kunjungan selesai. Entri baru masuk tabel
   berversi hanya saat final.
6. **Atestasi elektronik sesi** (keputusan fase 3 no. 2) di `clinical_attestations` (append-only): `cosign`, `verify`,
   `review_order`. Unik per (target, jenis, pengguna), dan satu co-sign per entri (indeks parsial). Trigger memastikan
   target ada untuk pasien yang sama. Status tampilan `menunggu_cosign` = `cosign_required` tanpa atestasi co-sign,
   sehingga status di database tetap dua nilai. TTE tersertifikasi hanya untuk dokumen legal (resume, persetujuan,
   resep) lewat P08.
7. **Baca lewat view `<tabel>_current`** (security_invoker, versi tanpa pengganti). Riwayat pasien selalu dibaca lewat
   `app_patient_group` (ADR-0016).
8. **Kode baku dari data rujukan.** Trigger `app_clinical_code_guard` menolak ICD-10/ICD-9-CM/LOINC yang tidak ada
   (atau nonaktif) di `ref.concepts` untuk entri baru (`REF_CODE_UNKNOWN`). Ini cara menegakkan "kode tidak dikarang"
   tanpa FK lintas skema yang tidak dimodelkan Prisma.
9. **Tim perawatan tutup-sekali.** `encounter_participants`: satu DPJP utama aktif per kunjungan, dan periode hanya
   bisa diakhiri sekali (`app_encounter_participant_guard`). Ganti DPJP = akhiri yang lama + baris baru.
10. **Izin baru ke RS yang sudah berjalan** lewat sinkron katalog (`pnpm db:sync-permissions`, ADR-0012). Sinkron
    hanya menambah izin yang baru di katalog ke peran yang memilikinya di matriks bawaan, dan izin yang pernah dicabut
    admin tidak diberikan lagi. Tidak ada migrasi SQL data izin, karena migrasi tidak bisa membaca jejak pencabutan
    per RS.
11. **Skema Prisma multi-berkas** `prisma/schema/<domain>.prisma`. Tabel klinis ada di `clinical.prisma`; potongan
    berikutnya menambah berkas domainnya sendiri.

## Konsekuensi

- Modul API cukup memakai satu layanan (`ClinicalRecordService`, potongan 3.1) untuk versi, koreksi, salah entri,
  addendum, dan kunci. Pelanggaran yang lolos dari kode tetap ditolak database.
- Kode galat trigger berawalan stabil (`CLINICAL_CHAIN`, `RECORD_LOCKED`, `RECORD_NOT_FINAL`, `REF_CODE_UNKNOWN`,
  `CLINICAL_ATTESTATION`, `PARTICIPANT_CLOSED`). API memetakannya ke kode galat klinis di `@simrs/shared`.
- Selisih kecil antara pemeriksaan kunci TTE dan permintaan TTE yang berjalan bersamaan tidak dikunci baris, karena
  aplikasi tidak punya hak `FOR SHARE` atas tabel append-only. Layanan TTE (3.1) wajib mengambil kunci advisory per entri
  saat meminta tanda tangan dan saat koreksi.
- "Satu diagnosis utama per kunjungan" tidak bisa dijadikan indeks unik, karena versi terkini bukan kolom. Aturan ini
  ditegakkan API (potongan 3.2a) di bawah kunci per kunjungan.
- View `_current` memakai `NOT EXISTS` pada indeks `(tenant_id, supersedes_id)`. Daftar per kunjungan memakai indeks
  `(tenant_id, encounter_id)`.
