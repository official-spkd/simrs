# ADR-0130 · Override insisi sebelum time out hanya oleh operator atau dokter anestesi kasus itu

Status: diterima · 8 Okt 2026 (audit agen BUG atas fase 4 potongan 4.7; keputusan koordinator)

## Konteks

ADR-0106 butir 5 mengatur notifikasi override insisi, tetapi siapa yang boleh meng-override hanya diperiksa lewat izin
`surgery.override` (lingkup `relationship` untuk dokter). Akses kasus memakai `surgery.checklist` lingkup relasi,
sehingga dokter mana pun yang berelasi dengan pasien, misalnya DPJP bangsal yang tidak ikut operasi, bisa mencatat
insisi tanpa time out. Audit BUG membuktikan permintaan itu diterima (201).

## Keputusan

1. Override insisi sebelum time out hanya boleh oleh anggota tim kasus yang **aktif** (`surgery_case_team.ended_at`
   kosong) dengan peran **`operator` atau `anestesi`**, dan peran sesinya memegang `surgery.override`.
2. Asisten operator, dokter berelasi lain (DPJP bangsal, konsultan), dan perawat ditolak **403**. Keputusan menginsisi
   tanpa time out adalah tanggung jawab operator atau dokter anestesi.
3. Layar Kamar operasi hanya menampilkan tombol **Override insisi** bagi operator/anestesi tim kasus itu, agar tidak
   ada tombol yang selalu ditolak.
4. Alasan, audit `review`, dan notifikasi mutu tetap seperti ADR-0106.

## Akibat

- `SurgeryService.recordEvent` memeriksa keanggotaan tim sebelum izin; tes `apps/api/test/surgery-audit.test.ts`.
- Trigger DB 4.0b tidak berubah (tetap menegakkan alasan + urutan); pemeriksaan peran tim ada di service karena
  bergantung pada sesi pelaku.
