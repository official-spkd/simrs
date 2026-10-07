# Serah-terima · fase-3-a2-consent-consult (3.7 + 3.8)

- Diperbarui: 7 Okt 2026 sore (Asia/Jakarta)
- Status: siap integrasi (menunggu tinjauan DOC)
- Pemilik sesi: Claude Code (agen A2)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a45e0d816db28866a`
- Branch: `worktree-agent-a45e0d816db28866a` (master terbaru sudah digabung)
- Tujuan: 3.7 persetujuan tindakan tablet + edukasi (K11); 3.8 konsultasi/rawat bersama, paket formulir + kelengkapan,
  dokumen pasien (K10, K15, utang P08).
- Kepemilikan: modul API `consent`, `consult`, `care-packages`; komponen web `components/klinis/patient-documents.tsx`.
- Sumber daya: DB `simrs_test_fe2`, port E2E 4030/3030/3031/4130, migrasi 20261007200000–20261007299999.

## Sudah dikerjakan

- 3.7 (ADR-0058): migrasi `20261007200000_consent_drafts` (draf tablet tutup-sekali, RLS FORCE, hak per kolom);
  alur draf → tanda tangan (PNG biner ke draf / ketik nama) → atestasi saksi petugas → final `consent.sign` (PDF + TTE
  lewat `ClinicalSigningService.issueSigned`) / penolakan / batal; pencabutan = entri `dicabut` baru; syarat edukasi
  tindakan paham (`CONSENT_EDUCATION_REQUIRED`, keputusan orkestrator).
- 3.8 (ADR-0059, tanpa migrasi): `/consults/*` (jawaban hanya konsultan → `CONSULT_NOT_RECIPIENT`, akses konsultan 24
  jam, rawat bersama/alih rawat → tim perawatan), `/encounters/:id/care-team[/primary]`, `/care-packages`,
  `/encounters/:id/completeness`; komponen dokumen pasien web (BFF unggah/batal/minta TTE/unduh).
- Cadangan WIP lama (`wip/3.7-persetujuan-3.8-konsultasi`) dipakai sebagai bahan; tidak digabung utuh.

- Sambungan layar 3.8: tab "Dokumen & konsultasi" Rawat inap (kelengkapan, konsul + tim, dokumen pasien), layar
  Konsultasi dan Paket layanan hibrida, `GET /consults/consultants`; E2E `konsultasi-api.spec.ts`.
- Prioritas 1 (temuan BUG): layar Edukasi hibrida + `GET /encounters/:id/education`, tautan tablet → Edukasi, label
  `edukasi_tindakan` diperbaiki, `e2e/persetujuan.spec.ts` + fixture E2E edukasi.

## Validasi

Lihat laporan akhir A2 (angka tes, migrate diff, E2E).

## Kendala dan langkah berikutnya

- Paket layanan khusus (HD/kemo/ANC) tetap mode presentasi (keputusan fase 3 no. 18).
- Layar Asesmen (`/klinis/asesmen`) masih demo saja; isian P07 lain lewat API sudah ada.
- Tablet persetujuan mode api (W5a) memakai `consentDraftSchema`.

## Pengambilalihan

Agen A2 berhenti setelah laporan akhir.
