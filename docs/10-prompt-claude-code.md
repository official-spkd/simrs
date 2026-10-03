# 10 · Cara kerja dengan Claude Code + prompt per fase

## Ritme kerja yang disarankan

1. Satu fase = beberapa sesi. Mulai sesi dengan `/lanjut` (atau tempel prompt fase di bawah).
2. Minta Claude Code **merencanakan dulu** (plan mode) untuk tiap potongan besar; setujui atau koreksi rencananya sebelum ia menulis kode.
3. Potongan kecil: satu modul atau satu alur per putaran, selalu dengan tes. Commit setiap potongan hijau.
4. Setelah satu fase selesai: jalankan `/cek-mrmik` dan `/review-keamanan`, perbaiki temuan, lalu mulai sesi baru (bersihkan konteks) untuk fase berikutnya.
5. Bila Claude Code ragu atau dokumen bertentangan, biarkan ia bertanya. Jawaban Anda dicatat di `PROGRESS.md` atau ADR.

Perintah kustom di `.claude/commands/`:
| Perintah | Fungsi |
|---|---|
| `/fase <n>` | Kerjakan fase n sesuai `09-rencana-fase.md` (rencana → eksekusi bertahap → definisi selesai) |
| `/lanjut` | Baca `PROGRESS.md`, ambil langkah berikutnya yang belum selesai |
| `/layar <Nama>` | Bangun satu layar dari `design/mockups/<Nama>.dc.html` |
| `/cek-mrmik` | Audit kepatuhan 51 EP terhadap kode saat ini, perbarui matriks |
| `/review-keamanan` | Review diff/branch dengan checklist `05-keamanan.md` |
| `/mock <sistem>` | Tambah/perbaiki endpoint mock + skenario panel kendali |

---

## Prompt pembuka (sesi pertama)

```
Baca CLAUDE.md, README.md, dan semua file di docs/ (02 dan 03 cukup baca judul + tabel). 
Ringkas dalam 15 baris: apa yang dibangun, stack, prinsip yang tidak boleh dilanggar, dan urutan fase.
Lalu periksa prasyarat lokal (node, pnpm, docker compose, port 3000/4000/4100/5432/6379/9000/8025 bebas).
Jangan menulis kode dulu. Tanyakan kalau ada yang tidak jelas.
```

## Fase 0

```
/fase 0
Konteks tambahan:
- Windows + WSL2 Ubuntu, repo di filesystem Linux (~/proyek/simrs), Docker Desktop dengan integrasi WSL.
- Pakai versi stabil terbaru dari NestJS, Next.js, Prisma, BullMQ, Tailwind saat ini; kunci di pnpm-lock.
- infra/postgres/init.sql sudah ada (role simrs_migrator & simrs_app, ekstensi). Gunakan DATABASE_URL (app) dan MIGRATOR_DATABASE_URL (migrasi) dari .env.example.
Urutan: (1) workspace + config bersama, (2) packages/db + RLS + tes isolasi, (3) apps/api health/ready/swagger,
(4) apps/worker outbox + DLQ, (5) apps/mock kerangka 7 sistem + panel, (6) packages/ui token + /dev/ui di apps/web,
(7) skrip root + Playwright smoke test. Commit tiap langkah. Akhiri dengan checklist Definisi selesai fase 0.
```

## Fase 1

```
/fase 1
Prioritas urutan: P01 → P02 (dengan MFA TOTP & Mailpit) → P03 (RBAC+ABAC, break-the-glass) → P04 (audit hash berantai + layar Audit)
→ P05 (MPI + enkripsi kolom + merge + mock Dukcapil) → P06 (master rujukan subset) → P07 (form engine + layar Formulir)
→ P08–P12. Bangun layar Login, Akses, Audit, Formulir, MPI dari design/mockups.
Seed 2 tenant fiktif. Untuk setiap modul tulis tes izin dan tes isolasi tenant.
```

## Fase 2

```
/fase 2
Implementasikan F01–F08. Konektor BPJS (VClaim + Antrean + HFIS) lewat outbox ke apps/mock dengan tanda tangan dan enkripsi respons seperti docs/06.
Task id 1–7 dikirim dari event domain, bukan dari tombol UI. Display antrean via SSE.
Layar: Registrasi, Jadwal, Anjungan (/kiosk, target sentuh ≥ 64px), DisplayAntrean (/display/antrean).
Tambahkan tes E2E: check-in anjungan → SEP → antrean poli muncul di display.
```

## Fase 3

```
/fase 3
Bangun K01–K15. Mulai dari encounter + CPPT berversi + diagnosis, lalu triase IGD, ADT/bed, CPOE + order set + mesin CDS
(aturan JSON: alergi, interaksi, duplikasi, dosis ginjal; level info/warn/block; override beralasan), eMAR dengan verifikasi gelang,
consent tablet + TTE (mock), resume otomatis + rekonsiliasi obat.
Publikasikan event domain (OrderPlaced, MedicationAdministered, BedOccupied, EncounterFinished, ResumeSigned) untuk dipakai billing & SATUSEHAT.
Layar: Main, IGD, BedManagement, Ranap, CPOE, Consent, Resume.
```

## Fase 4

```
/fase 4
Bangun S01–S10 dengan fokus S01 lab (+ simulasi HL7 ORU dari mock), S09 nilai kritis (timer, read-back, metrik), S04/S05 farmasi (telaah, intervensi, stok batch FEFO),
S06 kamar operasi (checklist WHO terkunci berurutan, hitung kasa). Layar: Lab, Farmasi, OK.
```

## Fase 5

```
/fase 5
Bangun U01–U10. Charge capture murni dari event domain fase 3–4. Jurnal otomatis per event dengan tes properti debit = kredit.
Klaim: workbench koder + mock E-Klaim (new_claim → set_claim_data → grouper → claim_final → kirim) + status verifikasi.
Selisih naik kelas dihitung dari tabel aturan (angka simulasi, bisa diubah admin). Layar: Kasir (tanpa TPDI dulu), Klaim, Akuntansi.
```

## Fase 6

```
/fase 6
Ikuti docs/07-pembayaran-btn-tpdi.md dan ADR-0005. Modul payments (intent, kanal VA BTN/QRIS/EDC, webhook TPDI HMAC + idempotent, kedaluwarsa, refund 2 tingkat),
rekonsiliasi 3 arah, modul financing (cicilan pasien & pembiayaan piutang BPJS dengan auto-pelunasan).
Mock TPDI & BTN lengkap dengan pemicu di panel (bayar, webhook ganda, kedaluwarsa, setujui/cairkan, BPJS bayar klaim).
Layar: PembayaranBTN, PembiayaanBTN, metode baru di Kasir. Tes wajib: webhook ganda, tanda tangan salah, nominal beda, plafon terlampaui.
```

## Fase 7

```
/fase 7
Integration hub (I01) + SATUSEHAT (I02) penuh dengan packages/fhir (fungsi pemetaan murni + tes snapshot), lalu lengkapi I03–I06.
Uji skenario: semua mock eksternal mati 30 menit → layanan klinis tetap jalan → pulih → antrean outbox terkirim berurutan.
Layar: Integrasi.
```

## Fase 8

```
/fase 8
B01 logistik penuh (Layar Logistik), B03 SDM inti, B06 mutu (indikator otomatis dari data), B09 RM administratif (retensi, pemusnahan berjejak, permintaan salinan).
Modul lain struktur dasar dan dapat dimatikan per tenant.
```

## Fase 9

```
/fase 9
I09 Dasbor direksi (Layar Dasbor). apps/mobile (Expo) mode pasien dan mode klinisi sesuai AppPasien/AppDokter.
Auth pasien terpisah; pembayaran tagihan dari aplikasi lewat payments (fase 6).
```

## Fase 10

```
/fase 10
Halaman /simulasi + 3 tes Playwright end-to-end sesuai design/mockups/Simulasi.dc.html.
Backup/restore terenkripsi + uji restore. Prototipe edge sync untuk registrasi + mode downtime.
Isi matriks 51 EP MRMIK di docs/MRMIK-MATRIX.md dengan bukti. Jalankan /review-keamanan menyeluruh.
```

---

## Prompt utilitas

**Bangun satu layar**
```
/layar Ranap
```

**Saat tes gagal berulang**
```
Berhenti menambah fitur. Jelaskan akar masalah tes <nama>, tunjukkan bukti (log/stack), usulkan perbaikan minimal, lalu kerjakan.
Jangan melemahkan atau menghapus tes.
```

**Review sebelum commit besar**
```
Tinjau diff terhadap CLAUDE.md bagian 4 dan 05-keamanan.md checklist. Laporkan pelanggaran saja, urut dari yang paling berisiko.
```
