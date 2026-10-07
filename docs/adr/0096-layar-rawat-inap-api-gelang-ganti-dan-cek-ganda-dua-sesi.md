# ADR-0096 · Layar Rawat inap mode api: ganti gelang beralasan, cek ganda dua sesi, daftar ber-ABAC

Status: diterapkan pada layar W4 (fase 3) · 7 Oktober 2026

## Konteks

Layar Rawat inap (W4) menyambungkan CPPT, observasi + NEWS2, eMAR, askep, dan hasil ke API. Ada empat hal yang
belum diatur rencana fase 3:

1. Mode presentasi punya "override verifikasi manual dua identitas" yang **membuka** eMAR tanpa pindai. Keputusan
   fase 3 no. 8 menyatakan tidak ada jalur melewati pindai, sedangkan CLAUDE.md §4.9 mensyaratkan override beralasan,
   tercatat, dan dapat ditinjau.
2. ADR-0077 mewajibkan atestasi cek ganda dari **sesi perawat kedua** atas isi dosis yang sama persis (termasuk
   `scanId` milik pemberi dan waktu dosis). Layar perlu cara agar perawat kedua mengetahui pindaian rekannya, dan
   pemberi mengetahui isi dosis yang diatestasi.
3. Tidak ada endpoint daftar pasien rawat inap per unit/bed yang disaring ABAC.
4. Layar perlu tahu apakah tanda vital memicu eskalasi menurut ambang RS (`ews.escalation_score`), bukan ambang
   bawaan klien.

## Keputusan

1. **Gelang tidak terbaca = ganti gelang, bukan membuka eMAR.** Perawat (izin `medication.administer` + `bed.write`)
   memverifikasi dua identitas, menulis alasan ≥ 10 karakter, lalu `POST /encounters/:id/wristband/reprint`
   membatalkan gelang lama dan menerbitkan gelang baru (diaudit, alasan tersimpan di `void_reason`). Gelang baru tetap
   wajib dipindai sebelum dosis apa pun. Keputusan no. 8 utuh; jejak override = penggantian gelang beralasan.
2. **Cek ganda dua sesi lewat dua bacaan baru** (tanpa migrasi):
   - `GET /api/v1/nursing/wristband-scans?encounterId=`: pindaian cocok yang masih berlaku (gelang aktif, umur ≤
     `emar.scan_valid_minutes`) dari petugas mana pun;
   - `GET /api/v1/nursing/double-checks?encounterId=`: atestasi atas pindaian yang masih berlaku, berisi isi dosis
     beku dan penanda `used`.
   Perawat kedua memilih pindaian rekan + dosis, memindai label, lalu `POST /nursing/double-checks` dari sesinya.
   Pemberi memakai waktu, label, dan alasan dari atestasi itu saat `POST /nursing/administrations`. Keduanya izin
   `medication.administer`, ABAC pasien, diaudit `read`.
3. **`GET /api/v1/inpatients?unitId=`** (modul worklist, K04, `clinical.read`): kunjungan `IMP` berjalan per unit
   tempat pasien kini (unit bed, atau unit kunjungan sebelum ber-bed). Saringan ABAC di SQL sebelum batas baris
   lewat `patientAccessSql` (sumber aturan sama dengan `PatientAccessService.basis`); audit `read` per pasien yang
   tampil.
4. **`ews.escalated` dihitung server** di setiap rekaman tanda vital (`vitalSignsRecordSchema.ews.escalated`) dengan
   ambang RS. Ringkasan pasien (K14) tetap memakai bentuk EWS lamanya.
5. Rute eMAR/askep 3.5 mendapat alias kanonik `/api/v1/encounters/:id/{emar,care-plans,fluid-balances}` (keputusan
   orkestrator); layar memakai rute kanonik, rute `/nursing/...` tetap berlaku.
6. Eskalasi langsung di layar memakai aliran SSE `ews` lewat BFF `/klinis/rawat-inap/events`; nama pasien diambil
   dari daftar yang sudah lolos ABAC, bukan dari muatan aliran (tetap tanpa PHI).

## Konsekuensi

- Tidak ada jalur override yang membuka eMAR tanpa pindai. Bila RS butuh pemberian darurat tanpa gelang (mis. gelang
  belum tercetak), itu keputusan produk baru.
- Label obat fase 3 = UUID baris order (ADR-0077); di layar diketik/dipindai ke kotak "Kode label obat". Label
  farmasi fase 4 menggantikannya tanpa mengubah alur.
- Cek ganda menuntut dua perangkat/sesi. Perawat kedua di perangkat yang sama perlu keluar-masuk akun; atestasi
  ulang-masuk di perangkat yang sama (step-up) belum dibuat.
- Daftar rawat inap menghitung alergi per pasien (satu kueri per baris, maks. 300 baris); perlu dioptimalkan bila
  bangsal sangat besar.
