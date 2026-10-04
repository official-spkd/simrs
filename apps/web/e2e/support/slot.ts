/**
 * Slot E2E salinan repo ini: port bisa diganti lewat env agar beberapa salinan (git worktree) menjalankan E2E
 * bersamaan dengan database tes masing-masing. Dipakai `playwright.config.ts` dan helper tes.
 * Mock bawaan = port API + 100 (seperti 4000 → 4100 di `pnpm dev`), jadi slot lama yang hanya menyetel
 * `E2E_API_PORT` otomatis mendapat mock sendiri.
 */

/**
 * Port ≥ 1024 yang ditolak `fetch` (Node/undici: "bad port") dan browser, menurut daftar port terblokir WHATWG Fetch.
 * Contoh nyata: API 4090 → mock bawaan 4190 (ManageSieve); mock menyala, tetapi worker dan helper tes gagal mengirim.
 */
const FETCH_BLOCKED_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697,
  10080,
]);

/** Port slot dari env (atau bawaan); gagal di awal dengan pesan jelas, bukan "fetch failed" di tengah tes. */
function slotPort(name: string, fallback: number): number {
  const port = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || FETCH_BLOCKED_PORTS.has(port)) {
    throw new Error(
      `${name}=${port} tidak bisa dipakai E2E (di luar 1024–65535 atau diblokir fetch/browser). Setel ${name} ke port lain.`,
    );
  }
  return port;
}

export const E2E_API_PORT = slotPort('E2E_API_PORT', 4010);
export const E2E_WEB_PORT = slotPort('E2E_WEB_PORT', 3010);
export const E2E_DEMO_PORT = slotPort('E2E_DEMO_PORT', 3011);
export const E2E_MOCK_PORT = slotPort('E2E_MOCK_PORT', E2E_API_PORT + 100);

/** Mock integrasi + panel kendali E2E (loopback IPv4: di macOS `localhost` bisa dijawab aplikasi lain lewat ::1). */
export const E2E_MOCK_URL = `http://127.0.0.1:${E2E_MOCK_PORT}`;
