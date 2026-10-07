# Serah-terima · fase-3-a1 (3.6 → W1 → W5b)

- Pemilik: Claude Code, agen A1 (brief backend penuh 7 Okt 2026).
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a1979c2452dadb582`, branch `worktree-agent-a1979c2452dadb582`.
- Slot: DB `simrs_test_fe1` (port 5433), E2E 4020/3020/3021/4120, migrasi 20261007100000–20261007199999.
- `.env` worktree (tidak di-commit) mengarah ke `simrs_test_fe1` untuk semua URL DB; port API/WEB/MOCK 4020/3020/4120.

## Potongan 3.6 · resume, rekonsiliasi, pulang, gerbang (K13, EP 5c)

- Kontrak `packages/shared/src/schemas/discharge.ts`; galat `RESUME_INCOMPLETE`; `resumeCompleteness(checklist, required)`.
- Migrasi `20261007100000_death_certificates` (entri klinis berversi; indeks manual `death_certificates_supersedes_once`,
  `death_certificates_one_per_encounter` terdaftar di schema-guard).
- Modul `apps/api/src/modules/discharge/`: `DischargeSourcesService` (himpun sumber), `DischargeService` (draf,
  rekonsiliasi, finalisasi, addendum), `DeathCertificateService` (K-1), `EncounterCloseService`, `FullDischargeGate`
  dan `DischargeAuthority` (disediakan `AdtModule` sebagai `DISCHARGE_GATE`, menggantikan `BasicDischargeGate`).
- Semua TTE lewat `ClinicalSigningService.issueSigned` (catatan peninjau).
- Draf generik jenis `resume` ditolak (`drafts.service.ts`).
- Tes: `apps/api/test/discharge.test.ts`; `adt-triage.test.ts` kini menanam resume final ber-TTE sebelum memulangkan
  rawat inap dan memeriksa 409 tanpa resume.
- Keputusan: ADR-0093.

HEAD 3.6 dikirim ke orkestrator: `08b2ba49` (master `718880b6` sudah digabung).

## W1 · layar Poli mode api

- API: `GET /api/v1/poli/worklist`, `GET /api/v1/encounters/:id/poli-visit` (`apps/api/src/modules/encounter/poli.*`),
  kontrak `packages/shared/src/schemas/poli.ts`; tes di `apps/api/test/discharge.test.ts` (describe W1).
- Web: `app/(staf)/klinis/poli/{api-poli,api-poli-client,actions-api}.tsx|ts`; komponen bersama memakai `PoliOps`.
- E2E: `apps/web/e2e/klinis-poli.spec.ts`.

## W5b · layar Resume mode api

- Web: `app/(staf)/klinis/resume/{api-resume-list}.tsx`, `[encounterId]/{api-resume,api-resume-client,actions-api}`;
  cetak PDF lewat rute unduh dokumen bersama `/klinis/dokumen/:id/unduh`.
- E2E: `apps/web/e2e/klinis-resume.spec.ts`.

## Utang

- TTE resume/surat kematian yang gagal: API mendukung koreksi beralasan, layar belum punya tombol "tanda tangani ulang"
  (sementara lewat `POST /documents/:id/signatures`).

## 3.9 · Penutup fase 3 (A1, 7 Okt 2026)

- **E2E dua alur penuh mode api** (gabungan dengan rantai BUG `fb7376ee`/`5efe00cf`, tanpa duplikasi):
  - `apps/web/e2e/rantai-rawat-jalan.spec.ts`: booking JKN → anjungan → loket (task 2) → Pendaftaran BPJS + SEP terbit
    (mock) → TTV perawat poli → dokter jadwal HFIS: panggil + mulai periksa (task 4) → CPOE: order lab + sefadroksil
    diblokir CDS (alergi amoksisilin) → override beralasan → SOAP + ICD-10 + kondisi/cara pulang → resume RJ ber-TTE +
    tutup (task 5) → staging.
  - `apps/web/e2e/rantai-rawat-inap.spec.ts`: daftar IGD → triase (turun beralasan) → dokter jaga ambil pasien →
    keputusan rawat inap → alokasi bed → admisi + gelang (DPJP = praktisi akun uji) → CPPT DPJP → TTV/EWS → CPOE resep IV
    → eMAR terkunci sampai gelang → dosis → tablet persetujuan (paham + goresan + saksi petugas + edukasi paham + TTE)
    → resume (diagnosis dari layar Resume, isian DPJP, rekonsiliasi, 12/12, TTE) → pulang di papan bed → staging.
  - `e2e/support/staging.ts`: semua pesan SATUSEHAT kunjungan `held` (tidak ada yang terkirim) + jenis `billable_events`.
- **Temuan BUG W1** (worklist poli): bawaan = antrean poli unit + kunjungan hari ini dengan `practitioner.userId` saya;
  pemilih poli/sesi dari jadwal hari ini (`?poli=`). Tes API (semua unit, lintas poli, filter, tanpa bocor) + E2E.
- **Utang tanda tangan ulang** ditutup: resume dan surat kematian (versi koreksi beralasan, isian DPJP dari versi gagal);
  panel surat kematian di layar Resume.
- **Review keamanan** (agen peninjau, read-only) → perbaikan kecil di branch ini: jalan pintas TTE dokumen generik
  ditutup (409), unggahan berjenis resume/persetujuan ditolak (422), addendum wajib tim DPJP, audit per pasien di
  worklist poli, sebab kematian tidak masuk audit, `enteredInError` TTV memakai mode tulis, UUID resume divalidasi
  sebelum ke API, CSP sandbox di unduhan BFF, BFF poli tidak lagi mengarang ACVPU/O2/kondisi/cara pulang. Temuan besar
  dicatat di `docs/05-keamanan.md` §6.
- **Dataset tes slot**: `number_sequences` antrean disinkronkan dengan tiket yang ada (versi awal fixture poli membuat
  nomor tiket langsung); fixture kini memakai `allocateQueueNumber`.

### DoD fase 3 · bukti per kriteria (untuk DOC)

| Kriteria                                                                                        | Bukti API                                                                                                            | Bukti layar/E2E (mode api)                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entri klinis final tidak bisa diubah; koreksi berversi                                          | `clinical-infra.test.ts`, `clinical-records.test.ts`, `discharge.test.ts` (RECORD_LOCKED, versi 2 setelah TTE gagal) | `klinis-resume.spec.ts` (final → isian terkunci, addendum), `rawat-inap-api.spec.ts` (koreksi/addendum CPPT)                                                  |
| Resep berlergi diblokir; override beralasan tercatat                                            | `orders.test.ts` (sefadroksil 422 → override 201 + `cds_alerts`)                                                     | `cpoe.spec.ts`, `rantai-rawat-jalan.spec.ts` (blok → override → `cds_alerts` override + alasan)                                                               |
| Pemberian obat tidak tercatat sebelum gelang terverifikasi                                      | `nursing.test.ts` (API + DB)                                                                                         | `rawat-inap-api.spec.ts` (gelang salah ditolak), `rantai-rawat-inap.spec.ts` (slot terkunci → pindai → dosis)                                                 |
| Resume menarik diagnosis, tindakan, hasil, obat tanpa input ulang; terkunci setelah TTE         | `discharge.test.ts` (isi = sumber + ref, 12 butir, RECORD_LOCKED)                                                    | `klinis-resume.spec.ts`, `rantai-rawat-inap.spec.ts` (anamnesis CPPT, "1× diberikan" dari eMAR, 12/12, TTE), `rantai-rawat-jalan.spec.ts` (resume RJ ber-TTE) |
| Residen tidak bisa memfinalkan CPPT tanpa co-sign DPJP                                          | `clinical-notes.test.ts`, `discharge.test.ts` (status co-sign poli)                                                  | `rawat-inap-api.spec.ts` (residen → menunggu co-sign → DPJP co-sign)                                                                                          |
| Aturan umum (migrasi + seed, izin/isolasi/ABAC, audit, teks Indonesia, gerbang hijau, E2E demo) | seluruh `pnpm test`                                                                                                  | `demo/semua-layar.spec.ts`, `smoke.spec.ts`                                                                                                                   |
| Staging SATUSEHAT `held` + `billable_events` (rencana §3.9)                                     | `clinical-records.test.ts`, `discharge.test.ts` (Composition/Encounter held)                                         | kedua rantai lewat `support/staging.ts`                                                                                                                       |
