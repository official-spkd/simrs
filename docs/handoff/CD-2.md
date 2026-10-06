# Serah-terima · CD-2 · Klinis interaktif

- Diperbarui: Sel, 6 Okt 2026 · 16.40 WIB
- Status: **siap integrasi**
- Pemilik sesi: Claude Code (agen CD-2)
- Worktree: `/Users/godam/PROYEK/simrs/.claude/worktrees/agent-a3af8ce8198660c39`
- Branch dan commit terakhir: `cd/cd-2` (basis `master` c6f3d04, sudah digabung dengan `master` e997e9c; lihat `git log -1 cd/cd-2`). Belum di-push.
- Tujuan dan kriteria selesai: `docs/13-pembagian-tugas-cd-cx.md` §6 CD-2. Semua aksi layar klinis tersimpan di toko demo bersama (ADR-0085), bertahan setelah muat ulang, mengalir ke layar terkait; gerbang memakai pengguna sesi; tanpa label "tidak disimpan".
- Rencana/otorisasi pengguna: tugas CD-2 dari CD-0 (front end mode presentasi; tanpa API backend, migrasi, dependensi baru).
- Kepemilikan file/modul: `app/(staf)/klinis/**`, `app/(perangkat)/tablet/**`, `components/{klinis,rawat-inap,rme,onkologi}/**`, `lib/{klinis*,rawat-inap*,rme*,onkologi*}.ts`, fixture klinis, `lib/server/data/klinis/**`, satu baris per domain di `lib/demo/store/registry.ts`.
- Sumber daya: DB `simrs_test_cd_a` (Postgres 127.0.0.1:5433), slot E2E 4020/3020/3021/4120, `E2E_TMP_NAME=simrs-demo-e2e-cda`. Skrip env di scratchpad sesi (`cd2/env.sh`, `cd2/run-e2e.sh`), tanpa `.env`.

## Sudah dikerjakan

### Potongan 1 · domain `rekam-medis` (Rawat inap, CPPT, Worklist)

- `lib/rme-toko.ts` (+ `rme-toko-bagan.ts` untuk bagan FE2): satu domain untuk rekam medis pasien yang dipakai bersama layar Rawat inap dan bagan RME, agar aksi di satu layar tampil di layar lain. Kejadian: `cppt.ditulis` (baru/koreksi/addendum), `cppt.cosign`, `cppt.verifikasi`, `emar.diberikan`, `observasi.dicatat`, `askep.intervensi`, `askep.evaluasi`, `askep.diagnosis`, `serahterima.diserahkan`, `serahterima.diterima`, `worklist.selesai`, `asesmen.disimpan`.
- Server: `lib/server/data/klinis/rekam.ts` (baca/terapkan toko, `commitCpptNote`, `commitCpptSign`, `klinisSession`), `ranap.ts` menerapkan toko ke rekam rawat inap fixture, `rme.ts` (`rmeChart`, `rmeChartById`), `worklist.ts` (sumber status worklist + nilai kritis dari `hasil-kritis`).
- Rawat inap: CPPT/co-sign/eMAR/intervensi askep tersimpan; **observasi baru** (isian TTV + pratinjau EWS, skor dihitung server). Pasien skenario tetap lewat tugas Simulasi (CPPT/askep ditolak dengan alasan; eMAR diperiksa server lalu dicatat tugas `emar`).
- CPPT (RME): catatan, co-sign, verifikasi, serah terima SBAR tersimpan; sumber sama dengan Rawat inap.
- Worklist: penyelesaian langsung tersimpan; tugas selesai sendiri bila rekamnya selesai di layar lain (co-sign di CPPT/Rawat inap, dosis di eMAR); co-sign dari worklist dicatat sebagai co-sign CPPT yang sama. Tugas nilai kritis menampilkan status pelaporan lab dari domain `hasil-kritis`.
- Gerbang dari sesi: co-sign/verifikasi hanya posisi dokter yang membawakan DPJP pasien, bukan catatan sendiri (id pengguna); koreksi hanya penulis (id pengguna untuk catatan tersimpan); cek ganda obat high-alert oleh orang lain.

### Potongan 2 · CPOE, IGD, tempat tidur, resume, persetujuan, poli

- `klinis-order` (`lib/klinis-order-toko.ts`): order lab/radiologi/resep/tindakan yang ditandatangani tersimpan (CDS diperiksa ulang server, override beralasan). `klinis-igd`: triase (turun level wajib alasan), pasien datang sendiri, dokter penanggung jawab, permintaan bed, disposisi meninggal. `tempat-tidur`: alokasi bed + transisi status (melanggan `admisi.diminta`, `pasien.meninggal`, `resume.final`). `resume-medis`: butir, rekonsiliasi, resume final TTE (hanya dokter). `persetujuan`: consent final/ditolak di tablet (TTE hanya dokter). `klinis-poli`: panggil antrean, TTV, draf/tanda tangan CPPT, co-sign residen.
- Mengalir: permintaan bed IGD tampil di papan Tempat tidur; alokasi tampil di IGD dan Rawat inap ("Masuk dari IGD"); resume final membuka pemulangan bed ("Pulang hari ini") dan butir Kelengkapan; consent final/ditolak tampil di Kelengkapan.

### Potongan 3 · bagan RME FE2 + onkologi

- Asesmen, Diagnosis (operasi berversi; diagnosis akhir hanya DPJP), Konsultasi (jawaban hanya konsultan tujuan), Edukasi, Asuhan keperawatan (ronde obat → eMAR yang sama, evaluasi, diagnosis baru), Paket layanan (butir, gerbang lab tunda/override beralasan, sesi), Kelengkapan (co-sign, TTE ulang, batal, unggah pindaian, surat keterangan kematian, tutup kunjungan dengan rekam terkunci), Ringkasan (alergi/masalah dari toko, pelaporan nilai kritis), Onkologi (`onkologi`: kunci order, gerbang lab, verifikasi ganda berurutan).
- Worklist menutup tugas dari rekam rujukannya (`ref` di fixture: CPPT, dosis eMAR, resume, konsul, asesmen, evaluasi askep). Rawat inap menampilkan banner "Nilai kritis pasien" dari domain `hasil-kritis`.
- Disposisi meninggal (K-1 §8, **menunggu konfirmasi pemilik produk**): hanya dokter penanggung jawab (IGD) / DPJP (Kelengkapan); jam kematian, sebab ICD-10 dari seed (`DEATH_CAUSES`), nomor surat keterangan kematian `SKK/<RS>/<nomor>`; tutup kunjungan "meninggal" butuh surat ber-TTE; admisi rawat inap pasien meninggal ditolak.

## Kontrak kejadian yang diterbitkan

Tabel lengkap (field per kejadian) ada di `docs/panduan/19-peta-kode.md` bagian "Aliran klinis (CD-2): kontrak kejadian". Ringkas:

- CX-1 (penunjang/farmasi): `klinis-order/order.ditandatangani` (`lines[].dest` lab/radiologi/farmasi), `persetujuan/consent.final|consent.ditolak` (OK sign-in), `onkologi/siklus.diverifikasi` n=2 (peracikan), `rekam-medis/emar.diberikan` (stok depo).
- CX-2 (keuangan): `klinis-order/order.ditandatangani` (charge, `tariff`), `rekam-medis/emar.diberikan` (tagihan obat), `resume-medis/resume.final` (klaim, `codes`, `los`, `guarantor`), `rekam-medis/diagnosis.dicatat` (koding), `klinis-poli/cppt.ditandatangani` final + `cppt.cosign` (kasir), `tempat-tidur/bed.status` (tagihan kamar), `klinis-igd/pasien.meninggal`.
- CX-3 (back office/command center): `klinis-igd/triase.disimpan|admisi.diminta|pasien.meninggal`, `tempat-tidur/bed.dialokasikan|bed.status`, `rekam-medis/kunjungan.ditutup`.
- CD-3: `klinis-poli/antrean.dipanggil` (display antrean).
- Permintaan masuk (belum ada, CD-2 akan melanggan bila diterbitkan CX-1): `obat.diserahkan` (dispensing → eMAR), `hasil.divalidasi` (hasil → Ringkasan/Worklist).

## Permintaan ke pemilik registri

- Tidak ada perubahan `screens.ts`/`nav.ts`/sidebar yang dibutuhkan. `registry.ts` hanya menambah delapan baris domain klinis.

## Label "(simulasi)" yang tersisa (bukan keadaan yang tidak tersimpan)

- "Pindai gelang (simulasi)" (askep, eMAR) dan pindai label obat: simulasi perangkat pemindai; hasil pindai diperiksa server.
- "Unggah (simulasi)" (Kelengkapan): pindaian berkas tidak diunggah sungguhan; entri dokumen tersimpan di toko.
- "Perjalanan rawat (simulasi)" (Rawat inap): lompat hari skenario rawat inap, bukan aksi rekam.
- "Konfirmasi penerimaan (simulasi penerima)" (serah terima SBAR): penerima masih nama staf fixture; konfirmasi tersimpan atas nama pengguna sesi.

## Validasi

- Setelah merge `master` e997e9c: `pnpm lint` · lolos. `pnpm typecheck` · lolos. `pnpm --filter @simrs/web test` · lolos (126 berkas, 895 tes; tes baru `lib/rme-toko.test.ts`, `lib/klinis-alur-toko.test.ts`).
- E2E slot CD-2 (`demo-desktop` + `demo-tablet`): `rawat-inap`, `klinis`, `fe2-klinis`, `simulasi`, `superadmin-demo`, `semua-layar`, `toko-demo`, `fe5-backoffice` · 186 lolos, 0 gagal.

## Kendala dan langkah berikutnya

- Rekam medis tidak melanggan `hasil-kritis` (tes CD-1 `state-actions.test.ts` mengunci daftar layar yang dimuat ulang); status nilai kritis dibaca langsung dari domain itu setiap render.
- Celah demo yang tetap untuk backend: verifikator kemoterapi dan perawat pemeriksa kedua dipilih dari daftar nama; relasi DPJP = posisi dokter yang membawakan DPJP persona.
- K-1 disposisi meninggal menunggu konfirmasi pemilik produk.
- Belum dilanggan (tersedia setelah merge CD-3): `pendaftaran/kunjungan.terdaftar` dan `antrean/antrean.dipanggil` (via display) ke antrean Poli. Antrean poli masih dari fixture + panggilan tersimpan di `klinis-poli`; menyambungkannya butuh membangun kunjungan poli dari pendaftaran (tugas lanjutan).

## Pengambilalihan

Selesai; tidak ada pekerjaan setengah jalan. Integrasi: merge `cd/cd-2` ke `master`, lalu jalankan gerbang di atas. `docs/PROGRESS.md` tidak diubah (wewenang integrator).
