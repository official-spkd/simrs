# ADR-0107 · Farmasi klinis: depo tujuan, CDS saat telaah per putaran, gerbang telaah, intervensi tanpa mengubah resep

Status: diterapkan pada potongan 4.5 (fase 4, S04) · 8 Oktober 2026

## Konteks

Rencana fase 4 §4.5 meminta telaah resep tiga aspek (administratif, farmasetik, klinis), CDS ulang saat telaah,
tindak lanjut peringatan, dan intervensi apoteker. Skema 4.0b menyediakan `pharmacy_prescriptions` (satu per kiriman
CPOE `order_groups`), riwayat status, `prescription_reviews`, `pharmacist_interventions` + jawaban, dan aturan murni
`alertBlocks`/`reviewBlock` di `@simrs/shared`. Empat hal belum diatur:

1. Kiriman CPOE tidak menyimpan depo tujuan, padahal lingkup `unit` penunjang (ADR-0034) = order yang ditujukan ke
   unit penugasan.
2. Skema 4.0b tidak punya tempat untuk temuan CDS saat telaah dan tindak lanjut apoteker. Temuan CPOE (`cds_alerts`)
   milik dokter dan dicatat sekali saat kirim.
3. Bagaimana override dokter di CPOE ditinjau apoteker.
4. Siapa yang mengubah resep setelah intervensi.

## Keputusan

1. **Depo tujuan dari kelas kunjungan** (ASUMSI fase 4, perlu dikonfirmasi RS pilot): rawat jalan (`AMB`) ke
   `DEPO-RJ`, rawat inap (`IMP`) ke `DEPO-RI`, IGD (`EMER`) ke `DEPO-IGD` (kode lokasi stok seed 4.0b). Antrean masuk
   (`GET /pharmacy/incoming`) memuat kiriman 7 hari terakhir yang masih punya obat aktif, belum diterima farmasi,
   kunjungannya tidak batal, dan depo tujuannya dalam lingkup sesi. Lingkup `unit` = depo yang unitnya sama dengan unit
   penugasan; `all` = semua depo. Apoteker memilih depo saat menerima (`POST /pharmacy/prescriptions`); API memeriksa
   ulang lingkupnya.
2. **Terima = satu resep farmasi per kiriman.** Nomor `R-YYMM-NNNN`, status `telaah`, riwayat status, evaluasi CDS
   awal, event `pharmacy.service_started`, dan audit. Kiriman yang sama diterima dua kali → 409 (kunci advisory +
   indeks unik `(tenant, order_group_id)`).
3. **CDS saat telaah per putaran evaluasi** di tabel append-only baru `pharmacy_cds_alerts` (satu `evaluation_id` per
   putaran, yang berlaku = putaran terbaru) dan `pharmacy_cds_alert_decisions` (satu per temuan: `konfirmasi`,
   `override` beralasan 10–500 karakter, atau `usul`). Mesin CDS yang sama dengan CPOE (ADR-0030) dijalankan atas obat
   aktif resep dengan konteks terkini (alergi, eGFR, obat aktif). Obat resep itu sendiri dikeluarkan sekali dari "obat
   aktif" dan "order terbaru" agar tidak terbaca duplikasi dirinya. Pemetaan: `block` ke mayor, `warn` ke sedang,
   `info` ke info. Aturan `biaya` dan `aman` tidak ikut. Obat kewaspadaan tinggi menambah temuan info `high-alert`.
   Putaran tanpa temuan tetap dicatat (satu info "Tidak ada temuan CDS") agar putaran lama tidak berlaku lagi.
4. **Override dokter atas temuan blok di CPOE wajib ditinjau apoteker.** Temuan mayor yang sama pada item yang sama
   ditandai `prescriber_override` (status `override`, alasan dokter tampil di detail). Temuan ini menahan telaah sampai
   apoteker mengonfirmasi atau meng-override dengan alasannya sendiri.
5. **Gerbang telaah.** `setujui` ditolak 409 `CDS_UNRESOLVED` selama ada temuan mayor/sedang terbuka atau override
   dokter yang belum ditinjau (`alertBlocks` bersama). `sebagian` hanya diblokir temuan pada item yang disetujui.
   `tahan` dan `sebagian` wajib beralasan. Hasil: `setujui`/`sebagian` ke `penyiapan`, `tahan` ke `ditahan` (telaah
   ulang boleh dari `ditahan`). Tindak lanjut final (konfirmasi/override) dibawa ke putaran evaluasi ulang bila
   temuannya sama persis (aturan, item, pesan). `usul` tidak dibawa: setelah dokter mengubah order, apoteker
   mengevaluasi ulang dan memutuskan lagi.
6. **Intervensi tidak mengubah resep.** Apoteker mengirim usulan (`ganti_obat`, `ubah_dosis`, `hentikan`, `tambah`,
   `lainnya`) untuk item resep itu. Dokter penulis mendapat notifikasi tanpa PHI (nomor resep saja). Perubahan order
   tetap lewat CPOE oleh dokter. Jawaban (`POST /pharmacy/interventions/:id/response`, izin `order.write`) hanya dari
   dokter penulis, sekali per usulan; `ditolak` wajib beralasan. Apoteker diberi notifikasi jawaban.
7. **Stok depo di layar telaah dari ledger.** Jawaban resep memuat stok layak per item (`stock.usable`, batch tidak
   kedaluwarsa di depo resep, dan minimum profil formularium). Layar Farmasi mengambil kolom stok dari API stok
   (`GET /stock/balances`), ledger yang sama dengan ADR-0036.

## Konsekuensi

- Dua tabel baru, append-only juga bagi pemilik tabel, waktu dari server, RLS FORCE + `tenant_isolation`, role
  aplikasi hanya SELECT/INSERT. Riwayat temuan per putaran utuh untuk audit mutu.
- Izin: `pharmacy.review.read/write` (apoteker, lingkup unit) untuk antrean, resep, CDS, intervensi, dan telaah.
- Belum dikerjakan di potongan ini: layar CPOE belum menampilkan usulan apoteker (dokter menjawab lewat API; tautan
  notifikasi membuka CPOE kunjungan), dan task 6/7 BPJS dari tiket antrean farmasi masih manual. Resep tidak otomatis
  `batal` saat dokter membatalkan semua item di CPOE; item batal tampil berstatus `dibatalkan` di telaah.
- Penyiapan, cek ganda, serah terima, dan pengurangan stok dari resep berstatus `penyiapan` menyusul potongan 4.6b.
