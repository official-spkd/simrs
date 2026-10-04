# ADR-0018 · Data rujukan: skema `ref` di luar Prisma, impor gagal-tertutup, contoh dari mockup

Status: diterima · 4 Okt 2026

## Konteks
docs/01 §3 menetapkan data rujukan global (ICD-10, ICD-9-CM, LOINC, KFA, wilayah) di skema `ref` tanpa `tenant_id` dan read-only bagi aplikasi. CLAUDE.md §4.10 melarang mengarang kode. Repo belum memuat dataset resmi, padahal tes dan demo butuh contoh. Dataset resmi besar (LOINC ±100 ribu kode) dan sering berganti versi, jadi pengisiannya perlu bisa diulang dengan aman.

## Keputusan
1. **Skema `ref` ditulis manual, tidak dimodelkan Prisma.** Tabel `ref.code_systems` (versi + asal dataset), `ref.concepts` (`system` + `code` + `display` + `active` + `extra` JSON), `ref.regions` (hierarki dari kode Kemendagri). Akses lewat SQL berparameter di `@simrs/db` (`ref.ts`). Tanpa RLS (global, tanpa data pasien); `simrs_app` hanya punya SELECT, diperiksa `schema-guard.test.ts`. Prisma tidak melihat skema ini, sehingga tidak muncul sebagai drift.
2. **Impor lewat CLI `pnpm db:import-ref` (role migrator), gagal tertutup.** Seluruh berkas berlaku dalam satu transaksi. Satu baris tidak valid (format kode per sistem, check digit LOINC, label kosong, kode ganda, jumlah kolom tidak sama dengan judul) membatalkan semuanya dan semua masalah dilaporkan per baris. `--dry-run` hanya memvalidasi; `--replace` menonaktifkan kode yang tidak ada di versi baru (tidak menghapus). Versi dan asal dataset dicatat.
3. **Seed hanya contoh dari mockup proyek.** 72 kode (29 ICD-10, 20 ICD-9-CM, 18 LOINC, 5 KFA) diambil apa adanya dari `design/mockups` dan diberi versi `contoh-mockup`. Seed tidak menyentuh sistem yang sudah berisi data (termasuk dataset resmi). Wilayah tidak di-seed: kode Kemendagri diimpor dari berkas resmi; tes memakai kode fiktif 97–99.
4. **Pencarian**: awalan kode, atau kata mirip di label lewat trigram `<%` (indeks GIN) dengan ambang kemiripan kata 0,5 yang disetel `SET LOCAL` per transaksi. Ambang bawaan 0,6 menolak salah ketik satu huruf.

## Konsekuensi
+ Tidak ada kode karangan di repo; dataset resmi bisa diganti versinya tanpa menghapus riwayat (kode lama nonaktif).
+ Berkas rusak tidak bisa mengisi data setengah jadi.
− Belum ada layar impor; operator memakai CLI. Lisensi LOINC dan akses dataset KFA/Kemendagri diurus operator.
− Pencarian butuh transaksi (ambang kemiripan per transaksi); API selalu berjalan dalam transaksi permintaan.
