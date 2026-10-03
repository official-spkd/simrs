# ADR-0001 · Stack: TypeScript, NestJS, Next.js, Prisma, PostgreSQL

Status: diterima · 3 Okt 2026

## Konteks
Satu tim kecil membangun 81 komponen dengan bantuan Claude Code, untuk empat kanal (web staf, anjungan/display, aplikasi pasien, aplikasi dokter). Butuh tipe yang dipakai bersama dari DB sampai UI, ekosistem FHIR/HL7, dan iterasi cepat.

## Keputusan
- Monorepo pnpm + Turborepo; TypeScript strict di semua aplikasi.
- API dan worker: NestJS (modular, DI, guard/interceptor untuk izin dan audit).
- Web: Next.js App Router + Tailwind; mobile: Expo.
- ORM: Prisma + PostgreSQL 16; SQL mentah hanya untuk RLS, view, dan laporan.
- Validasi: zod (skema bersama di `packages/shared`).
- Antrean: BullMQ (Redis). Penyimpanan objek: S3-compatible (MinIO lokal).

## Konsekuensi
+ Satu bahasa, skema validasi dipakai ulang, Claude Code produktif.
− Prisma butuh pola khusus untuk RLS (transaksi + `set_config`); laporan berat memakai SQL/view.
− Perlu disiplin batas modul agar monolit modular tidak menjadi kusut.
