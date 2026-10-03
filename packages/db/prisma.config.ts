import { defineConfig } from 'prisma/config';

// Migrasi dan seed memakai role pemilik tabel (simrs_migrator). Runtime aplikasi memakai simrs_app (DATABASE_URL).
// Prisma CLI tidak membaca .env otomatis; muat dari root repo bila ada.
try {
  process.loadEnvFile('../../.env');
} catch {
  // .env opsional (CI menyetel env langsung)
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.MIGRATOR_DATABASE_URL ?? 'postgresql://simrs_migrator:migrator_local@localhost:5432/simrs',
  },
});
