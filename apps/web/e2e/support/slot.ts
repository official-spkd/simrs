/**
 * Slot E2E salinan repo ini: port bisa diganti lewat env agar beberapa salinan (git worktree) menjalankan E2E
 * bersamaan dengan database tes masing-masing. Dipakai `playwright.config.ts` dan helper tes.
 * Mock bawaan = port API + 100 (seperti 4000 → 4100 di `pnpm dev`), jadi slot lama yang hanya menyetel
 * `E2E_API_PORT` otomatis mendapat mock sendiri.
 */
export const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 4010);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3010);
export const E2E_DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 3011);
export const E2E_MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? E2E_API_PORT + 100);

/** Mock integrasi + panel kendali E2E (loopback IPv4: di macOS `localhost` bisa dijawab aplikasi lain lewat ::1). */
export const E2E_MOCK_URL = `http://127.0.0.1:${E2E_MOCK_PORT}`;
