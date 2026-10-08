# ADR-0104 · Layar IGD dan Tempat tidur mode api: sinyal papan, admisi dari IGD satu langkah, ambil pasien

Status: diterima · 7 Okt 2026 (layar W3, agen A4) · diperbarui 8 Okt 2026

## Konteks

Layar IGD dan Tempat tidur (rencana fase 3 §W3) harus memakai API sungguhan dan diperbarui real-time di beberapa
jendela. Backend 3.3 sudah menyediakan papan + SSE, tetapi:

1. Kanal SSE hanya dipicu `ed_status_events` dan `bed_status_events`. Pendaftaran IGD, triase, permintaan bed (dibuat,
   dialokasikan, batal), dan kunjungan IGD yang selesai tidak sampai ke layar yang terbuka. Memakai id baris sumber
   untuk notifikasi UPDATE juga tidak bisa: koneksi SSE membuang id yang sudah terkirim dan pemuat membagi hasilnya
   2 detik.
2. Keputusan rawat inap dari IGD butuh admisi `IMP` (registrasi fase 2: DPJP, penjaminan, persetujuan umum) lalu
   `POST /adt/admissions`. Penjaminan BPJS di registrasi admisi meminta nomor rujukan yang tidak dimiliki kunjungan IGD.
3. Bentuk papan API berbeda dengan kontrak toko demo (ADR-0023 keputusan 4), dan dokter IGD belum punya relasi resmi
   untuk dokumen ber-TTE (tinjauan 3.6, pilihan c).

## Keputusan

1. **Tabel `board_signals`** (append-only, RLS FORCE, role aplikasi SELECT/INSERT): trigger `encounters` (kelas EMER),
   `triage_assessments`, `bed_requests`, dan `encounter_participants` menulis satu baris per perubahan; trigger tabel
   itu mengirim `pg_notify` ke `ed_board`/`bed_board` dengan id sinyal. Kanal memetakannya ke event `ed.changed` dan
   `bed.request` (id + kode, tanpa nama). Event papan = sinyal: layar memuat ulang data papan dari server
   (`router.refresh()`, dijeda 250 ms). Sinyal tidak diputar ulang; potret awal yang selalu dikirim setiap sambung ulang
   adalah kebenarannya.
2. **BFF SSE staf** (`proxyStaffStream`): route handler `/klinis/igd/events` dan `/klinis/tempat-tidur/events`
   meneruskan aliran API dengan token sesi dari cookie httpOnly; browser tidak memegang token.
3. **Admisi dari IGD satu langkah**: `POST /registration/emergency-admissions` (`encounter.write`, Idempotency-Key):
   permintaan bed IGD yang sudah `dialokasi` → admisi `IMP` (`sourceEncounterId` IGD, baris penjaminan IGD disalin apa
   adanya, kelas rawat dari permintaan) → `AdtService.admit` (bed, gelang, IGD selesai `rawat_inap`, SEP rawat inap BPJS)
   dalam satu transaksi. Validasi admisi dipakai bersama registrasi admisi (`insertPlannedAdmission`).
4. **Papan API diperkaya** (bukan diterjemahkan dengan nilai karangan): jenis kelamin, umur, cara datang, penjamin,
   dokter penanggung jawab, kode bed IGD, triase terkini, SEP IGD, bed IGD; papan bed membawa status Aplicare per ruang.
   Web memetakan item API ke baris tabel papan bersama mode presentasi (`EdBoardRow`); yang belum ada ditulis apa adanya
   ("Belum ditriase", "Belum ada penjamin").
5. **Saran triase dari server** juga saat mengetik: `POST /triage/suggestions` (tanpa menyimpan).
6. **Ambil pasien**: `POST /encounters/:id/care-team/claim` memasukkan dokter (peran ber-`clinical.sign`) ke tim
   `dpjp_utama` kunjungan IGD lewat `CareTeamService`; penanggung jawab lain diakhiri beralasan; diaudit `care_team`.
7. **Keputusan rawat inap** dicatat pemegang `bed.write` (perawat IGD, petugas admisi) atas instruksi dokter; katalog
   izin tidak diubah (dokter tetap tanpa `bed.write`).
8. **Utang 3.3**: status IGD terkini `changedAt desc, id desc` dengan `changedAt` naik ketat per kunjungan di bawah
   kunci kunjungan; langkah ADT mengunci ruang Aplicare terlibat dalam urutan tetap sebelum status bed diubah
   (dua transfer berlawanan arah: sebelumnya 500 deadlock, kini 201).

## Konsekuensi

- `board_signals` tumbuh satu-dua baris per perubahan papan; dibersihkan job worker `board.signals-cleanup`
  (lihat pembaruan di bawah).
- Layar IGD tidak lagi menulis `?pilih=` saat memilih pasien: perubahan query memasang ulang segmen halaman pada muat
  ulang SSE berikutnya dan menghapus isian triase. `?pilih=` tetap dibaca untuk tautan langsung.
- Pulang dari layar Tempat tidur menampilkan alasan `DISCHARGE_BLOCKED` dari `DischargeGate` 3.6; disposisi meninggal
  tetap di jalur dokter (surat kematian).

## Pembaruan 8 Okt 2026 · Pembersihan sinyal

Job berkala `board.signals-cleanup` (P11, tiap 15 menit per tenant) menghapus sinyal lebih tua dari 1 jam per batch
1.000 baris (maks. 20 batch per putaran) lewat fungsi sempit `app_purge_board_signals(before, limit)` (SECURITY
DEFINER, `search_path = public, pg_temp`, hanya tenant aktif, batch 1–5000, tidak pernah menghapus sinyal < 10
menit). Role aplikasi tetap tanpa DELETE pada `board_signals`.

## Pembaruan 7 Oktober 2026 · Papan IGD administratif dan lingkup relasi (ADR-0109)

- Loket pendaftaran IGD tidak lagi memegang `clinical.read`/`triage.write`. Papan IGD untuk loket:
  - `GET /triage/board/admission` (+ `/events`, `encounter.read`);
  - `view: 'administratif'`, `triage` null.
- Lingkup `relationship` di papan IGD dan papan bed menampilkan pasien berelasi saja.
- Catatan bebas permintaan bed hanya untuk peminta dan pelaku berelasi.
