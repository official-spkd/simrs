# 13 · Pembagian tugas Claude Code (CD) dan Codex (CX)

Papan tugas kerja simultan, disusun 6 Okt 2026 atas permintaan pemilik produk. Aturan koordinasi umum ada di `docs/12-codex-claude.md`; dokumen ini menetapkan **siapa mengerjakan apa, urutannya, dan batas berkasnya**. Status fase tetap di `docs/PROGRESS.md`; checkpoint tiap tugas di `docs/handoff/<ID>.md` (salin `docs/handoff/TEMPLATE.md` saat mulai).

- **CD-n** dikerjakan Claude Code.
- **CX-n** dikerjakan Codex.

## 1. Prinsip pembagian

Pembagian mengikuti lapisan, agar dua alat tidak pernah menyunting berkas yang sama secara bersamaan:

| Area                                                                                         | Pemilik                    | Catatan                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/api/**`, `apps/worker/**`, `apps/mock/**`                                              | **CX**                     | Modul, controller, service, repository, outbox, mock                                       |
| `packages/db/**` (skema Prisma, migrasi, seed, RLS)                                          | **CX**                     | Satu migrasi per tugas, nama berawalan cap waktu                                           |
| `packages/shared/**` (skema zod, izin, peran, event, kode galat)                             | **CX**                     | CD hanya membaca; perubahan kontrak lewat permintaan (§5)                                  |
| `apps/web/**` (layar, komponen, `lib/server/data/*`, E2E)                                    | **CD**                     | CX tidak menyunting web                                                                    |
| `packages/ui/**`                                                                             | **CD**                     |                                                                                            |
| `docs/panduan/**`, `docs/panduan/gambar/**`                                                  | **CD**                     | CX menambah bagian API di `docs/panduan/02-cara-kerja-kode.md` lewat tugasnya sendiri saja |
| `docs/05-keamanan.md`, ADR backend                                                           | **CX**                     |                                                                                            |
| `docs/PROGRESS.md`, `docs/adr/README.md`, `docs/13-*.md`                                     | **CD-0 (integrator)**      | Tugas lain menulis bukti di handoff masing-masing                                          |
| `package.json`, `pnpm-lock.yaml`, `turbo.json`, `.env.example`, `docker-compose.yml`         | **tidak ada**              | Butuh izin pemilik produk; tidak ada dependensi baru tanpa ADR                             |
| `CLAUDE.md`, `AGENTS.md`, `design/**`, `docs/03-regulasi-mrmik.md`                           | **pemilik produk**         |                                                                                            |

Nomor ADR dipesan agar tidak bentrok: **CX 0077–0084** (0077 sudah dipakai untuk 3.5), **CD 0085–0089**.

## 2. Integrasi ke `master` (satu pintu)

1. Setiap tugas bekerja di worktree dan branch sendiri:
   - CD: `.claude/worktrees/<…>`, branch `cd/<id-tugas>`.
   - CX: `~/.codex/worktrees/<id-tugas>/simrs`, branch `codex/<id-tugas>`.
2. Sebelum selesai, tugas menggabungkan `master` terbaru ke branch-nya dan menjalankan gerbang:
   - `pnpm lint && pnpm typecheck && pnpm test`;
   - E2E yang relevan di slot-nya (§3).
3. Lalu tugas menulis status **"siap integrasi"** di handoff-nya. Isinya: commit terakhir, bukti tes, dan migrasi baru.
4. **Hanya CD-0 (Claude Code, integrator)** yang menggabungkan ke `master` di checkout utama `/Users/godam/PROYEK/simrs`, menjalankan gerbang penuh + E2E, `pnpm db:deploy` ke database pengembangan, push, dan memperbarui `docs/PROGRESS.md`.
5. **Codex tidak lagi meng-commit atau menggabungkan langsung di checkout utama.** Checkout utama dipakai bersama oleh dev server pemilik produk dan integrator.
6. Bila CD-0 tidak tersedia (kuota habis), pemilik produk boleh menunjuk Codex sebagai integrator sementara. Penunjukan dicatat di handoff `CD-0`.

## 3. Sumber daya terpisah

| Pemakai                                | Database tes                     | Port E2E (API / web / demo / mock) | `E2E_TMP_NAME`        |
| -------------------------------------- | -------------------------------- | ---------------------------------- | --------------------- |
| CD-0 integrator (checkout utama)       | `simrs_test`                     | 4010 / 3010 / 3011 / 4110 (bawaan) | `simrs-demo-e2e`      |
| Dev server pemilik produk              | `simrs` (pengembangan)           | 4000 / 3000 / — / 4100             | —                     |
| CD tugas web A (CD-1, CD-3, CD-5)      | `simrs_test_cd_a`                | 4020 / 3020 / 3021 / 4120          | `simrs-demo-e2e-cda`  |
| CD tugas web B (CD-2, CD-4, CD-6)      | `simrs_test_cd_b`                | 4030 / 3030 / 3031 / 4130          | `simrs-demo-e2e-cdb`  |
| CX tugas backend A (CX-1, CX-3, CX-5)  | `simrs_test_codex_a`             | 4510 / 3510 / 3511 / 4610          | `simrs-demo-e2e-cxa`  |
| CX tugas backend B (CX-2, CX-4, CX-6)  | `simrs_test_codex_b`             | 4520 / 3520 / 3521 / 4620          | `simrs-demo-e2e-cxb`  |

- Nama database wajib `simrs_test_<nama>`. Buat dengan `docker compose exec postgres psql -U postgres -c "CREATE DATABASE simrs_test_<nama> OWNER simrs_migrator"`. Postgres Docker ada di 127.0.0.1:5433.
- Jangan pernah membuat ulang atau menghapus database tanpa izin.
- Dalam satu worktree, `pnpm test` dan E2E dijalankan bergiliran (tutorial §7).
- Port yang diblokir browser (4190, 5060, 6000, 6665–6669, 10080) jangan dipakai.

## 4. Gelombang kerja

Tugas dalam satu baris berjalan simultan. Panah = harus menunggu tugas itu digabung ke `master`.

| Gelombang | Claude Code (web)                    | Codex (backend)                                  |
| --------- | ------------------------------------ | ------------------------------------------------ |
| 1         | **CD-1** W3 IGD + Tempat tidur (api) | **CX-1** 3.7 Persetujuan tindakan + edukasi      |
| 1         | **CD-2** W2 CPOE (api)               | **CX-2** 3.8 Konsultasi, paket, dokumen pasien   |
| 2         | **CD-3** W4 Rawat inap ← CX-2        | **CX-3** 3.6 Resume + pulang ← keputusan K-1     |
| 2         | **CD-4** W5a Tablet persetujuan ← CX-1 | **CX-4** Perbaikan ADT/IGD + review keamanan 3.5–3.8 |
| 3         | **CD-5** W1 Poli ← CX-3              | **CX-5** Verifikasi staging SATUSEHAT + billable ← CX-3 |
| 3         | **CD-6** W5b Resume ← CX-3           | **CX-6** Katalog izin + peran rencana (utang FE) |
| 4         | **CD-7** Penutup 3.9 (E2E, QA, panduan, PROGRESS) | **CX-7** Penutup 3.9 sisi backend (keamanan, ADR) |
| terus     | **CD-0** Integrator                  | —                                                |

CX mengerjakan tugasnya **berurutan** dalam satu gelombang (CX-1 lalu CX-2), kecuali pemilik produk menjalankan dua sesi Codex dengan worktree dan database terpisah. Keduanya menyentuh `packages/shared` dan migrasi, jadi digabung satu per satu oleh CD-0.

## 5. Permintaan kontrak (CD → CX)

Bila layar membutuhkan kontrak yang belum ada (field respons, kode galat, endpoint baca), CD **tidak** menyunting `packages/shared` atau `apps/api`. Langkahnya:

1. Tulis permintaan di bagian "Permintaan kontrak" handoff CD: endpoint, bentuk data, alasan.
2. Tandai tugas CD "terhambat sebagian". Lanjutkan bagian yang tidak bergantung.
3. CX mengambil permintaan itu sebagai potongan kecil di tugas yang sedang berjalan, atau sebagai tugas `CX-K<n>`.
4. Setelah digabung CD-0, CD melanjutkan.

## 6. Keputusan pemilik produk yang ditunggu

| ID  | Pertanyaan | Menghambat | Usulan bawaan |
| --- | --- | --- | --- |
| K-1 | Siapa yang boleh memulangkan pasien dengan disposisi **meninggal**? (`DischargeGate`, temuan keamanan 6 Okt) | CX-3 | Hanya dokter berizin `clinical.sign` yang berelasi dengan pasien (DPJP/jaga), wajib jam kematian + sebab kematian ICD-10 + surat keterangan kematian ber-TTE; admisi ditolak 403. |
| K-2 | Bolehkah periode akuntansi ditutup bila masih ada jurnal yang menunggu penyetuju kedua? (temuan bug 6 Okt) | fase 5 (belum dijadwalkan) | Tidak boleh: tutup periode diblokir sampai antrean persetujuan kosong. |

## 7. Rincian tugas Claude Code (CD)

### CD-0 · Integrator (berjalan terus)

- **Tujuan:** `master` selalu hijau dan mencerminkan pekerjaan terbaru kedua alat.
- **Langkah per tugas "siap integrasi":**
  1. Baca handoff tugas dan periksa diff.
  2. `git merge --no-ff` ke `master`.
  3. Gerbang penuh: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`, lalu `pnpm --filter @simrs/web test:e2e`.
  4. `pnpm db:deploy` ke database pengembangan.
  5. Push dan perbarui `docs/PROGRESS.md`.
- **Merge merah:** perbaiki bila kecil dan jelas. Bila tidak, kembalikan ke pemilik tugas lewat handoff.
- **Berkas:** `docs/PROGRESS.md`, `docs/adr/README.md`, dokumen ini.

### CD-1 · W3 Layar IGD + Tempat tidur mode api (K03, K04, K05)

- **Dasar:** rencana fase 3 §W3. API 3.3 sudah ada di `master` (modul `adt`, `triage`, SSE papan IGD).
- **Berkas:** `apps/web/src/app/(staf)/klinis/{igd,tempat-tidur}/*`, `src/components/rawat-inap/{triage-*,bed-*,ed-*}.tsx`, `src/lib/server/data/klinis/{igd,tempat-tidur}.ts`, E2E `apps/web/e2e/klinis-igd.spec.ts`.
- **Isi:**
  1. Papan IGD dari API + SSE (potret awal + `Last-Event-ID`).
  2. Triase dengan saran sistem; turun level wajib alasan ≥ 10 karakter, ditolak server bila kurang.
  3. Pasien tanpa identitas.
  4. Permintaan bed → alokasi → admit; cetak gelang.
  5. Papan bed dengan status bertulisan (siap/terisi/dipesan/kotor/rusak) dan lingkup unit sesuai ABAC.
  6. Galat API dengan kode stabil ditampilkan dalam Bahasa Indonesia.
- **Jangan:** mengubah jalur demo selain yang perlu agar keduanya berbagi komponen; status di `screens.ts` untuk IGD/Tempat tidur tetap hibrida.
- **Selesai bila:**
  - E2E api: triase turun tanpa alasan diblokir → dengan alasan tersimpan dan tercatat di audit; permintaan bed → alokasi → admit → bed `terisi`; perawat lain unit 403.
  - Rute detail id tidak ada → 404 (utang 3.0d).
  - E2E demo tetap hijau.

### CD-2 · W2 Layar CPOE mode api (K09)

- **Dasar:** rencana §W2. API 3.4 (`/api/v1/orders`, pratinjau CDS, resep ber-TTE) sudah ada.
- **Berkas:** `apps/web/src/app/(staf)/klinis/order/*`, `src/components/klinis/cpoe-*`, `src/lib/server/data/klinis/order.ts`, E2E `apps/web/e2e/klinis-cpoe.spec.ts`.
- **Isi:**
  1. Katalog + order set dari API.
  2. Pratinjau CDS dari server: alergi, interaksi, duplikasi, dosis ginjal.
  3. Dialog override beralasan.
  4. Kirim dengan `Idempotency-Key`.
  5. Status TTE resep; batal beralasan.
  6. Nominal disembunyikan di mode api (tarif `null` sampai U01).
- **Selesai bila:**
  - E2E api: resep sefadroksil untuk pasien alergi amoksisilin diblokir → override beralasan → terkirim → audit memuat alasan.
  - Kirim ganda (klik dua kali) menghasilkan satu order.
  - E2E demo tetap hijau.

### CD-3 · W4 Layar Rawat inap mode api (K04, K07, K12) ← CX-2

- **Dasar:** rencana §W4. API 3.2b (CPPT), 3.5 (eMAR/askep, Codex), dan 3.8 (dokumen, CX-2).
- **Berkas:** `apps/web/src/app/(staf)/klinis/rawat-inap/*`, `src/components/rawat-inap/*` (kecuali `triage-*` milik CD-1), `src/lib/server/data/klinis/rawat-inap.ts`, E2E `apps/web/e2e/klinis-ranap.spec.ts`.
- **Isi:** keenam tab.
  1. Ringkasan.
  2. CPPT: co-sign residen, koreksi berversi, addendum, SBAR.
  3. eMAR: pindai gelang lalu dosis satu per satu; terlambat wajib alasan; high-alert cek ganda dari sesi petugas kedua.
  4. Observasi + EWS + balans cairan.
  5. Askep berversi.
  6. Hasil dan Dokumen.
- **Selesai bila:** E2E api memenuhi DoD fase 3:
  - pemberian tanpa pindai ditolak 422 → pindai → diberikan;
  - residen tidak bisa memfinalkan CPPT tanpa co-sign DPJP.

### CD-4 · W5a Tablet Persetujuan mode api (K11) ← CX-1

- **Berkas:** `apps/web/src/app/(perangkat)/tablet/persetujuan/*`, `src/components/rawat-inap/signature-*`, E2E `apps/web/e2e/tablet-persetujuan.spec.ts`.
- **Isi:**
  1. Sesi staf di tablet.
  2. Templat 7 butir informasi + teach-back.
  3. Tanda tangan pasien/wali + saksi (goresan PNG lewat unggahan biner ADR-0020, atau ketik nama).
  4. Finalize TTE oleh dokter; penolakan beralasan ≥ 10 karakter; pencabutan = versi baru.
- **Selesai bila:** E2E api:
  - dua tanda tangan → TTE → terkunci (ubah → 409);
  - penolakan beralasan menghasilkan dokumen penolakan;
  - finalize tanpa dua tanda tangan → 422 tampil jelas.

### CD-5 · W1 Layar Poli mode api (K01, K02) ← CX-3

- **Berkas:** `apps/web/src/app/(staf)/klinis/poli/*`, `src/components/klinis/{poli-*,patient-header,vitals-card,nurse-vitals-form,soap-*,visit-panels,status-flag}.tsx`, E2E `apps/web/e2e/klinis-poli.spec.ts`.
- **Isi:**
  1. Antrean dari modul `queue` (panggil → task 4).
  2. Banner pasien, TTV.
  3. SOAP autosave draf → final; ICD-10 dari rujukan.
  4. Rencana dan riwayat.
  5. "Tanda tangani dan selesai" → resume RJ ber-TTE + surat kontrol + task 5.
- **Selesai bila:** E2E api: panggil → TTV → SOAP + ICD-10 → selesai → resume RJ terkunci → task 4 dan 5 `sent` di mock Antrean.

### CD-6 · W5b Layar Resume mode api (K13) ← CX-3

- **Berkas:** `apps/web/src/app/(staf)/klinis/resume/*`, E2E `apps/web/e2e/klinis-resume.spec.ts`.
- **Isi:** bagian berlabel sumber, rekonsiliasi obat (dikonfirmasi DPJP), 12 butir kelengkapan dari server, TTE, addendum setelah final, cetak (audit `print`).
- **Selesai bila:** E2E api:
  - resume menarik diagnosis, tindakan, hasil, dan obat tanpa input ulang;
  - setelah TTE terkunci (ubah → 409 `RECORD_LOCKED`), addendum boleh.

### CD-7 · Penutup fase 3, sisi web dan integrasi

- **Isi:**
  1. Dua E2E rantai rencana §3.9: rawat jalan, dan IGD → ranap sampai Aplicare di mock.
  2. QA visual: `QA_VISUAL=1` dan `pnpm docs:gambar` untuk semua layar.
  3. Panduan `docs/panduan/12-fitur-klinis.md` bagian mode api.
  4. Regresi E2E demo.
  5. Centang 5 kriteria DoD fase 3 di PROGRESS dengan bukti.
- **Selesai bila:** E2E penuh hijau di `master`; DoD fase 3 dicentang.

## 8. Rincian tugas Codex (CX)

### CX-1 · 3.7 Persetujuan tindakan + edukasi (K11)

- **Dasar:** rencana fase 3 §3.7, ADR-0019 (form engine), ADR-0020 (dokumen + TTE), ADR-0028 (entri klinis berversi).
- **Berkas:**
  - `apps/api/src/modules/consent/*` (sekarang kerangka 9 baris);
  - `packages/shared/src/schemas/consent.ts`;
  - migrasi `packages/db/prisma/migrations/<cap-waktu>_consent`;
  - seed templat consent di P07;
  - tes `apps/api/test/consent.test.ts` dan tes DB.
- **Isi:**
  1. Templat consent sebagai formulir P07 (7 butir informasi wajib) dan edukasi lewat P07.
  2. Draf.
  3. Tanda tangan pasien/wali + saksi: PNG via unggahan biner atau ketik nama. Atestasi saksi petugas.
  4. `POST …/finalize` (`consent.sign`) → PDF bertanda tangan (`packages/pdf`) → TTE lewat outbox.
  5. Penolakan beralasan ≥ 10 karakter → dokumen penolakan + TTE. Pencabutan = versi baru.
  6. Audit setiap baca/cetak.
  7. Staging SATUSEHAT `held` Consent.
- **Tes:**
  - finalize tanpa dua tanda tangan → 422;
  - consent final tidak bisa diubah (409) bahkan oleh pemilik tabel;
  - isolasi tenant; ABAC relasi;
  - perangkat/peran tanpa izin → 403;
  - gerbang rute statis `route-security.test.ts` tetap hijau.
- **Untuk CD-4:** tulis bentuk respons endpoint di handoff.

### CX-2 · 3.8 Konsultasi/rawat bersama, paket formulir, kelengkapan, dokumen pasien (K10, K15, utang P08)

- **Dasar:** rencana §3.8, ADR-0012/0031 (relasi dan lingkup akses).
- **Berkas:** `apps/api/src/modules/{consult,care-packages}/*` (kerangka), perluasan `assessment` + `documents`, kontrak `packages/shared/src/schemas/{consult,care-packages}.ts`, migrasi `<cap-waktu>_consult_packages`, tes API/DB.
- **Isi:**
  1. Permintaan konsultasi + jawaban terstruktur hanya oleh konsultan yang dituju; akses konsultan berbatas waktu.
  2. Rawat bersama; ganti DPJP utama = versi baru, dan relasi akses ikut berubah.
  3. `GET /api/v1/care-packages?setting=` dan `GET /api/v1/assessment/encounters/:id/completeness` (EP 6b/7a).
  4. API dokumen pasien per kunjungan: daftar, unggah, batal beralasan, minta TTE.
- **Tes:**
  - konsultan bisa mengakses selama jendela berlaku, setelahnya 403;
  - menjawab konsul milik orang lain → 403;
  - kelengkapan per setting;
  - isolasi tenant;
  - dokumen batal tidak bisa di-TTE ulang (temuan bug 6 Okt di layar demo).

### CX-3 · 3.6 Resume, rekonsiliasi obat, pulang, gerbang tutup encounter (K13, EP 5c) ← keputusan K-1

- **Dasar:** rencana §3.6.
- **Berkas:** `apps/api/src/modules/discharge/*` (kerangka), `DischargeGate` di `adt`, kontrak `packages/shared/src/schemas/discharge.ts`, migrasi `<cap-waktu>_discharge_summaries`, tes.
- **Isi:**
  1. `POST /api/v1/discharge/summaries`: draf dihimpun dari sumber, dan tiap bagian membawa ref sumber.
  2. Rekonsiliasi obat dikonfirmasi DPJP.
  3. `POST …/:id/finalize` (`clinical.sign`): 12 butir diperiksa server → PDF + TTE → terkunci; addendum setelah final.
  4. Resume RJ ringkas untuk penutupan poli, yang memicu task 5.
  5. `DischargeGate`:
     - rawat inap = disposisi + resume final;
     - meninggal = aturan K-1;
     - rujuk = surat rujukan F07.
  6. Staging SATUSEHAT `held` Composition dan Encounter `finished`.
- **Tes:**
  - mengganti resume ber-TTE → 409 `RECORD_LOCKED`; addendum boleh;
  - tutup tanpa resume → 409;
  - isi resume sama dengan data sumber;
  - disposisi meninggal oleh admisi → 403.

### CX-4 · Perbaikan ADT/IGD + review keamanan backend 3.5–3.8

- **Isi:**
  1. Deadlock dua transfer berlawanan arah (`aplicare_rooms`/`bed_status`): urutkan kunci baris secara deterministik.
  2. Urutan status IGD terakhir `changedAt desc, id desc`.
  3. `/review-keamanan` untuk modul `nursing`, `consent`, `consult`, `care-packages`, `documents`, `discharge`. Cakupan: IDOR, ABAC, RLS FORCE, audit, PHI di log dan outbox.
- **Tes:**
  - dua transfer berlawanan serentak → keduanya selesai atau satu 409, tanpa 500;
  - urutan event dalam milidetik yang sama benar.

### CX-5 · Verifikasi staging SATUSEHAT `held` + `billable_events` ← CX-3

- **Isi:** tes integrasi yang menelusuri satu kunjungan rawat jalan dan satu IGD → ranap, lalu memastikan:
  - urutan resource `held` benar (Encounter → anak → Encounter `finished`);
  - `billable_events` lengkap dengan sumbernya (order, eMAR, ADT, tindakan);
  - tidak ada PHI di payload outbox selain yang diperlukan.
- **Selesai bila:** tes hijau dan tercatat di handoff, untuk dipakai sebagai bukti di 3.9.

### CX-6 · Katalog izin dan peran rencana (utang mode front end dulu)

- **Dasar:** `docs/panduan/19-peta-kode.md` bagian "Utang dari mode front end dulu".
- **Isi:**
  1. Tambahkan ke katalog izin `packages/shared` izin rencana yang dipakai layar fase 3 (`cppt.write`, `diagnosis.write`, `consult.write`, `education.write`, `nursing.write`, `care-package.write`, dll.), hanya yang benar-benar dipakai endpoint fase 3.
  2. Tambahkan peran `nutrisionis` (ahli gizi sebagai PPA CPPT) dengan matriks bawaan.
  3. Sinkronkan lewat `pnpm db:sync-permissions`; tes matriks.
- **Jangan:** menambah izin fase 4–9 yang belum punya endpoint.
- **Untuk CD:** catat di handoff izin mana yang kini bisa dipakai `screens.ts`. CD memperbarui `permission` di registri.

### CX-7 · Penutup fase 3 sisi backend

- **Isi:**
  1. Review keamanan penutup seluruh modul fase 3.
  2. ADR 0028–0032 dimutakhirkan bila implementasi menyimpang.
  3. `docs/05-keamanan.md` diperbarui.
  4. `pnpm audit --prod`.
  5. Bukti untuk CD-7.

## 9. Memulai tugas

**Claude Code** (CD-1 dan CD-2 dijalankan integrator sebagai agen di worktree terpisah; atau manual):

```bash
cd /Users/godam/PROYEK/simrs
claude --worktree cd-1
```

**Codex:** buka proyek SIM RS di Codex app dengan mode worktree, atau CLI:

```bash
git -C /Users/godam/PROYEK/simrs worktree add ~/.codex/worktrees/cx-1/simrs -b codex/cx-1 master
```

Prompt awal Codex (ganti ID):

```text
Kerjakan tugas CX-1 dari docs/13-pembagian-tugas-cd-cx.md di worktree ~/.codex/worktrees/cx-1/simrs
(branch codex/cx-1). Baca AGENTS.md, CLAUDE.md, docs/12-codex-claude.md, docs/13-pembagian-tugas-cd-cx.md,
docs/PROGRESS.md, dan docs/rencana/fase-3-klinis-rme.md. Salin docs/handoff/TEMPLATE.md menjadi
docs/handoff/CX-1.md dan perbarui setelah tiap potongan. Pakai database simrs_test_codex_a dan slot
port CX backend A di §3. Hanya sunting berkas milik CX (§1). Jangan menggabungkan ke master dan jangan
menyunting checkout utama; setelah gerbang hijau, tandai handoff "siap integrasi".
```
