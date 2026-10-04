// Pengganti paket `server-only` untuk Vitest. Next mengalihkan impor itu saat bundling (galat bila terbawa ke
// komponen klien); di tes unit (Node) modul server boleh diimpor, jadi cukup modul kosong.
export {};
