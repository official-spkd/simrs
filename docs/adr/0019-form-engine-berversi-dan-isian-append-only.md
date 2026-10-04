# ADR-0019 · Form engine: formulir sebagai data berversi, isian append-only, diff dihitung saat dibaca

Status: diterima · 4 Okt 2026 · Komponen: P07

## Konteks
MRMIK 6c meminta formulir rekam medis berversi: entri lama tetap ditampilkan dengan versi formulir saat diisi. MRMIK 8c dan ADR-0004 melarang menimpa entri final; koreksi harus berupa versi baru yang beralasan dan bisa ditelusuri. MRMIK 10a meminta hak tulis per profesi. Komite rekam medis perlu mengubah formulir (mis. Morse Fall Scale) tanpa menunggu rilis aplikasi, dan layar Audit (mockup "Detail koreksi · Versi 1 → versi 2") harus menampilkan nilai sebelum dan sesudah koreksi.

## Keputusan
1. **Definisi formulir adalah data.** `form_definitions.schema` (JSON: bagian, field, opsi bernilai skor, logika tampil, kategori skor, aturan) divalidasi `formSchemaSchema` di `@simrs/shared` yang dipakai API dan web. Bentuknya setara Questionnaire FHIR; pemetaannya dibuat di fase integrasi.
2. **Siklus versi: draf → diajukan → terbit.** Kelengkapan (`formReadyProblems`: label, judul bagian, opsi, kategori skor) baru ditagih saat diajukan, jadi draf setengah jadi selalu bisa disimpan. Menerbitkan butuh izin `forms.definition.publish`; versi berlaku sebelumnya diarsipkan di transaksi yang sama. Basis data menjamin satu versi berlaku dan satu draf terbuka per kode (indeks unik parsial), serta versi terbit/arsip beku seluruhnya (trigger `app_form_definition_guard` membandingkan `to_jsonb` baris lama dan baru, jadi kolom yang ditambahkan kelak ikut beku). Yang diizinkan hanya pengarsipan `published → archived` beserta `archived_at` dan jejak ubah (migrasi `20261004120000`). Semua langkah siklus satu kode diserialkan kunci `form:<kode>` per RS.
3. **Token konkurensi.** Ubah draf, ajukan, tarik, dan terbitkan menerima `baseUpdatedAt` (waktu ubah versi yang sedang dilihat). Bila draf sudah diubah orang lain, API menjawab 409 alih-alih menimpa diam-diam; penerbit juga hanya bisa menerbitkan versi yang ia lihat.
4. **Isian append-only.** `form_responses` hanya boleh SELECT/INSERT bagi aplikasi, dan trigger menolak UPDATE/DELETE dari siapa pun. Koreksi = baris baru (`version` + 1, `supersedes_id`, `root_id`, `correction_reason` wajib lewat CHECK). Indeks unik `supersedes_id` membuat satu versi hanya bisa digantikan sekali: dari dua koreksi serentak, satu berhasil dan lainnya 409. Salah entri = versi baru berstatus `entered_in_error`. Versi terkini dibaca lewat view `form_responses_current` (`security_invoker`). Daftar isian pasien membaca kelompok rekam medis (`app_patient_group`, ADR-0016), jadi isian di rekam medis lama yang sudah digabung ikut tampil; isian baru untuk rekam medis yang sudah digabung ditolak (409) dan diarahkan ke rekam medis tujuan.
5. **Versi formulir dikunci per isian.** Isian dan semua koreksinya divalidasi terhadap versi definisi saat isian pertama dibuat, walau formulir sudah diperbarui.
6. **Hak tulis berlapis.** Peran aktif sesi harus tercantum di `write_roles` definisi (penolakan diaudit lewat `AuditedDenial`), ditambah ABAC relasi pasien (P03). Skor dan kategori dihitung server (`scoreForm`), tidak diterima dari klien.
7. **Diff tidak disimpan di jejak audit.** Entri audit koreksi (`correct`) memuat alasan, kode formulir, versi asal/tujuan, status, dan **kunci** field yang berubah, tanpa nilainya. Nilai klinis adalah data kesehatan; jejak audit dibaca peran non-klinis dan bisa diekspor CSV. Detail Audit menghitung diff dari dua versi isian yang tersimpan saat dibuka, dan pembukaan itu dicatat sebagai `read` atas isian dengan `patientId`.
8. **Seed** memasang Morse Fall Scale dari mockup sebagai v1 berlaku per RS (`ensurePublishedForm`). Fungsi ini memakai kunci siklus yang sama, jadi aman dijalankan paralel. Sebelumnya dua proses E2E serentak sama-sama menyisipkan v1 dan gagal unique.

## Alternatif yang ditolak
- **Tabel per formulir**: setiap perubahan formulir butuh migrasi dan rilis, bertentangan dengan tujuan komite mengubah formulir sendiri.
- **UPDATE isian + tabel riwayat**: baris utama tetap bisa ditimpa (melanggar ADR-0004), dan riwayat bergantung pada disiplin kode, bukan dijamin basis data.
- **Menyimpan nilai sebelum/sesudah di detail audit**: data kesehatan ikut terbawa ke ekspor bukti akreditasi.

## Konsekuensi
+ Formulir berubah tanpa rilis aplikasi; entri lama tetap terbaca dengan versinya; koreksi tidak pernah menghilangkan nilai lama.
+ Invarian utama (append-only, satu pengganti per versi, satu versi berlaku, isi terbit beku) dijaga basis data, bukan hanya kode.
− Nilai isian berbentuk JSON: laporan per field dan ringkasan pasien (flag "Risiko jatuh tinggi" di banner) butuh ekstraksi; dibangun bersama layar klinis fase 2–3.
− Kunci field tetap antar versi. Di layar, field dari versi berlaku tidak bisa dihapus atau diganti kuncinya (integrasi dan ringkasan bergantung padanya).
− TTE belum ada (potongan 10). Panel koreksi di Audit menampilkan versi formulir, belum status tanda tangan.
