// Diimpor paling awal oleh main.ts agar .env root terbaca sebelum modul lain membaca process.env.
try {
  process.loadEnvFile('../../.env');
} catch {
  // .env opsional; env bisa disetel langsung
}
