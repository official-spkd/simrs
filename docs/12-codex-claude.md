# 12 · Codex dan Claude Code bersamaan

Tujuan: dua alat bisa mengerjakan tugas berbeda secara simultan, dan salah satunya dapat melanjutkan tugas yang sama ketika kuota alat lain habis. Panduan ini menyiapkan aturan dan checkpoint; perpindahan alat dilakukan pengguna. Riwayat chat tidak otomatis berpindah.

## Aturan dan status bersama

- `CLAUDE.md`: aturan proyek yang juga dibaca Codex melalui `AGENTS.md`.
- `docs/PROGRESS.md`: status fase dan bukti selesai; baca status ini sebelum memilih pekerjaan.
- `docs/handoff/<id-tugas>.md`: checkpoint tugas di worktree tugas. Salin `docs/handoff/TEMPLATE.md`; perbarui setelah tiap potongan dan sebelum berhenti.
- Perintah `/lanjut` Claude tersedia di `.claude/commands/lanjut.md`. Di Codex, gunakan prompt eksplisit di bawah; jangan menganggap perintah Claude otomatis tersedia di Codex.

Kuota masing-masing alat mengikuti akun yang digunakan. Catatan tugas memungkinkan kelanjutan lintas alat, tetapi tidak memindahkan kuota ataupun seluruh konteks percakapan. Jika kuota terputus mendadak, penerus memakai checkpoint terakhir bersama status/diff aktual.

## Dua tugas simultan

1. Tetapkan tugas dan pemiliknya: misalnya Claude mengerjakan modul API, Codex meninjau atau mengerjakan layar yang kontraknya sudah disepakati. Hindari dua tugas yang sama-sama mengubah skema, kontrak bersama, atau lockfile.
2. Gunakan worktree terpisah. Codex app mendukung worktree untuk mengisolasi perubahan. Claude lokal yang diperiksa mendukung `--worktree`.
3. Sepakati branch dasar yang berisi aturan terbaru. Perubahan belum di-commit di checkout utama tidak otomatis hadir di worktree baru; worktree lama juga tidak otomatis menerima pembaruan. Integrasikan file panduan yang diperlukan sebelum memulai sesi baru.
4. Setiap tugas mencatat path worktree, branch, kepemilikan file, serta database/port di checkpoint sendiri.
5. Satu penanggung jawab mengintegrasikan commit dan memperbarui status fase setelah meninjau hasil dan validasi. Jangan menyatakan pekerjaan selesai hanya karena agen lain mengatakan selesai.

Contoh membuka Claude dari repo ini (setelah aturan tersedia di branch dasar):

```bash
cd /Users/godam/PROYEK/simrs
claude --worktree claude-tugas-a
```

Di Codex app, pilih proyek SIM RS dan mode worktree untuk tugas B. Untuk penggunaan CLI, buat worktree sendiri dari branch dasar yang disepakati, lalu jalankan `codex` di sana. Periksa `git worktree list` dahulu; repo sudah memiliki worktree Claude, jangan menghapus atau memakai ulang milik sesi lain tanpa memastikan tugasnya berhenti.

Worktree hanya memisahkan file dan branch. Database, Redis, mock, port server, dan artefak eksternal perlu dipisahkan sendiri. Catatan `docs/PROGRESS.md` menyebut worker E2E memproses semua outbox dalam database tes: jangan menjalankan tes integrasi dan E2E bersamaan pada database yang sama. Default paling sederhana: satu sesi menjalankan tes/database/server, sesi lain mengedit atau meninjau. Jangan membuat ulang database atau menghapus volume tanpa izin eksplisit.

## Mengambil alih ketika kuota habis

1. Hentikan sesi agen lama dan pastikan tidak lagi menulis file, menjalankan Git, atau menguji database bersama. Catat proses server yang tetap berjalan.
2. Buka **path worktree tugas lama yang sama** di alat pengganti. Di terminal, masuk ke path tersebut lalu jalankan `codex` atau `claude`. Membuka checkout utama tidak otomatis membuka perubahan worktree tugas.
3. Minta penerus membaca checkpoint, `CLAUDE.md`, `AGENTS.md`, status fase, `git status --short`, `git diff`, serta file baru yang belum dilacak. Periksa kembali hasil tes yang belum terbukti.
4. Lanjutkan rencana yang sudah disetujui. Jangan reset, checkout ulang, membersihkan file, atau membatalkan perubahan hanya karena belum di-commit.
5. Ubah pemilik di checkpoint. Jika alat lama kembali tersedia, jangan melanjutkan sesi lamanya pada tugas ini tanpa serah-terima balik.

Prompt pengambilalihan (ganti ID tugas dan path sesuai checkpoint):

```text
Lanjutkan tugas <id-tugas> di worktree <path-absolut> dari Codex/Claude Code.
Agen sebelumnya sudah saya hentikan. Baca AGENTS.md, CLAUDE.md,
docs/12-codex-claude.md, docs/PROGRESS.md, dan docs/handoff/<id-tugas>.md.
Periksa branch, status, diff, dan file belum dilacak. Pertahankan perubahan yang ada.
Lanjutkan rencana yang sudah disetujui dalam checkpoint, validasi hasilnya,
dan perbarui checkpoint. Jangan mengambil tugas agen lain.
```

## Referensi dan pemeriksaan lokal

Pada 6 Oktober 2026, CLI yang terdeteksi: Codex `0.160.0`, Claude Code `2.1.289`. Keberadaan executable tidak membuktikan login atau sisa kuota. Dokumen ini tidak meluncurkan sesi coding kedua atau memasang pengalih kuota otomatis.

Worktree Codex dijelaskan dalam [dokumentasi resmi OpenAI](https://developers.openai.com/blog/mastering-codex-remote-for-engineering). Opsi Claude diverifikasi melalui `claude --help` pada mesin ini.
