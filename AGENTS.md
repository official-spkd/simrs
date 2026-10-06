<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
<!-- codebase-memory-mcp:start -->
For structural codebase exploration, use the installed `codebase-memory` skill.
<!-- codebase-memory-mcp:end -->

# Codex · SIM RS

- Baca seluruh `CLAUDE.md` sebagai aturan proyek bersama: bahasa, arsitektur, keamanan, konvensi, dan validasi berlaku juga untuk Codex.
- Di awal sesi, baca `docs/PROGRESS.md` dan `docs/12-codex-claude.md`. Jika melanjutkan tugas, baca catatan `docs/handoff/<id-tugas>.md` di worktree tugas tersebut.
- Kerja simultan memakai worktree dan tugas terpisah. Jangan mengubah atau membatalkan perubahan agen lain. Jangan menjalankan operasi Git yang mengubah checkout milik sesi lain.
- Sebelum mengambil alih tugas, pastikan agen sebelumnya sudah berhenti; periksa branch, `git status`, diff, dan catatan serah-terima. Lanjutkan perubahan yang ada, termasuk yang belum di-commit.
- Catat checkpoint setelah setiap potongan di `docs/handoff/<id-tugas>.md`: tujuan, worktree/branch, file berubah, bukti tes, kendala, dan langkah berikutnya. Jangan menunggu kuota habis.
- Rencana yang sudah disetujui pengguna tetap berlaku ketika berganti alat. Minta persetujuan baru hanya bila lingkup berubah atau tindakan memerlukannya.
- Tes integrasi/E2E, migrasi, seed, dan server yang berbagi database/port dijalankan bergiliran; paralel hanya setelah sumber daya benar-benar terpisah.
