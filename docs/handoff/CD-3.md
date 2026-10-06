# Serah-terima · CD-3 · Front office + platform interaktif

- Diperbarui: Sel, 6 Okt 2026 · 15.40 WIB
- Status: **berjalan**
- Pemilik sesi: Claude Code (agen CD-3)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a22af1b82bf3bb896`
- Branch dan commit terakhir: `cd/cd-3` (basis `master` c6f3d04, sudah memuat toko demo CD-1)
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §1 dan §6 CD-3.
- Rencana/otorisasi pengguna: tugas CD-3 dari CD-0 (front end mode presentasi saja; tanpa API backend, migrasi, dependensi baru).
- Kepemilikan file/modul: §2 baris "Front office + platform".
- Sumber daya: DB `simrs_test_cd_b` (Postgres 127.0.0.1:5433), slot E2E 4030/3030/3031/4130, `E2E_TMP_NAME=simrs-demo-e2e-cdb`. Skrip env di scratchpad sesi (`cd3/env.sh`, `cd3/run-e2e.sh`), tanpa `.env`.

## Sudah dikerjakan

### Potongan 1 · Front office (Pendaftaran, Jadwal, Anjungan, Display antrean, Info publik)

Tiga domain toko demo (ADR-0085), satu baris registri masing-masing:

| Domain        | Berkas                            | Kejadian                                                                                                                       |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pendaftaran` | `lib/front-office-pendaftaran.ts` | `sep.diterbitkan`, `kunjungan.terdaftar` (kontrak keluar), `kunjungan.dicetak`                                                 |
| `antrean`     | `lib/front-office-antrean.ts`     | `tiket.diambil`, `tiket.dipanggil`, `antrean.dipanggil` (kontrak keluar), `bantuan.diminta/ditangani`; melanggan `pendaftaran` |
| `jadwal`      | `lib/front-office-jadwal.ts`      | `kuota.diubah`, `cuti.dicatat` (alasan wajib), `cuti.dialihkan`, `hfis.dikirim`                                                |

- Jalur data: `lib/server/data/front-office/toko.ts` (`frontOfficeStore`, `scheduleOf`, `quotasOf`, `deskOf`, `loketOf`, `boardOf`, `displayOf`, `commitFresh`) dipakai halaman, Server Action, dan info publik. `getWeeklySchedule`/`getRegistrationDesk`/`getQueueBoard` (cabang demo) kini memakainya.
- Aliran: anjungan (tiket A-0xx beridentitas, didahulukan dari walk-in) → papan TV (strip "Loket pendaftaran", polling 3 dtk tanpa muat ulang) → "Panggil berikutnya" di loket (formulir memuat pasien tiket) → SEP → kunjungan baru (`kunjungan.terdaftar`) → kuota jadwal +1, nomor poli berikutnya maju, PD-028 di "Berikutnya" papan TV → "Panggil berikutnya"/otomatis di papan (`antrean.dipanggil`). Cuti hari ini menghapus dokter dari kuota hari ini (meja, info publik). Info publik membaca jadwal/antrean/loket dari toko.
- Gerbang: satu kunjungan per pasien per hari; BPJS wajib SEP; kuota per penjamin; kuota tidak di bawah booking; cuti beralasan; nomor tiket/panggilan dihitung server (bukan klien); pasien sama tidak check-in dua kali.
- Label "(simulasi, tidak disimpan)" di Pendaftaran dan Jadwal hilang.

## Validasi

- `pnpm --filter @simrs/web typecheck`, `lint` (berkas berubah), `vitest` (123 berkas) · lolos.
- E2E `e2e/demo/front-office.spec.ts` (`demo-desktop`) · 7 lolos, termasuk tes baru "anjungan → papan TV tanpa muat ulang → loket memanggil → kunjungan baru di papan" dan cek bertahan (muat ulang) di pendaftaran, jadwal, anjungan, display.

## Kendala dan langkah berikutnya

- Berikutnya: Downtime (banner), Pengaturan (modul aktif), Struktur, Terminologi, Dokumen + TTE, Penjadwal, Rujukan, Cadangan, Go-live.

## Pengambilalihan

Agen CD-3 masih berjalan.
