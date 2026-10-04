import type { IntegrationTarget } from '@simrs/shared';
import { E2E_MOCK_URL } from './slot';

/**
 * Kendali mock integrasi E2E lewat API panelnya (apps/mock/src/panel/panel.ts):
 * - `POST /_panel/api/scenario` `{ system, mode: 'normal'|'lambat'|'gagal'|'acak', latencyMs?, failStatus? }`
 * - `POST /_panel/api/reset` → `{ ok: true }` (skenario normal, invoice/kotak masuk/echo/log kosong)
 * - `GET /_panel/api/state` → `{ systems, echoes, log, messages, invoices, … }` (daftar dipotong: log 50, lainnya 20–30)
 *
 * Keadaan mock dipakai bersama SEMUA tes yang sedang berjalan (semua proyek dan worker Playwright). Tes yang mengubah
 * skenario: satu proyek saja, `test.describe.configure({ mode: 'serial' })`, sistem yang tidak dipakai tes paralel
 * lain, dan kembalikan ke `normal` di `afterEach`. `resetMockState()` juga menghapus data mock milik tes lain.
 */

/** Gangguan per sistem yang bisa disimulasikan E2E. */
export type MockMode = 'normal' | 'lambat' | 'gagal' | 'timeout';

export interface MockScenarioOptions {
  /** Mode `lambat`: jeda per permintaan (bawaan 3000 ms). */
  latencyMs?: number;
  /** Mode `gagal`: kode HTTP (bawaan 503). */
  failStatus?: number;
}

/** Bentuk `POST /_panel/api/scenario`. */
interface PanelScenario {
  system: IntegrationTarget;
  mode: 'normal' | 'lambat' | 'gagal' | 'acak';
  latencyMs?: number;
  failStatus?: number;
}

/**
 * Jeda yang melewati batas waktu klien (worker E2E 2 dtk, `OUTBOX_HTTP_TIMEOUT_MS`): panel belum punya mode
 * `timeout`, jadi timeout = `lambat` sepanjang ini (batas panel 60 dtk). Nilai lambat/gagal selalu dikirim eksplisit
 * karena panel mempertahankan nilai sebelumnya bila kosong.
 */
const TIMEOUT_LATENCY_MS = 60_000;

/** Satu-satunya pemetaan mode E2E → panel mock; ganti di sini bila panel menambah mode `timeout` sendiri. */
function toPanelScenario(system: IntegrationTarget, mode: MockMode, o: MockScenarioOptions): PanelScenario {
  switch (mode) {
    case 'normal':
      return { system, mode: 'normal' };
    case 'lambat':
      return { system, mode: 'lambat', latencyMs: o.latencyMs ?? 3000 };
    case 'gagal':
      return { system, mode: 'gagal', failStatus: o.failStatus ?? 503 };
    case 'timeout':
      return { system, mode: 'lambat', latencyMs: TIMEOUT_LATENCY_MS };
  }
}

async function panel<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${E2E_MOCK_URL}/_panel/api/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Panel mock ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Atur gangguan satu sistem mock (berlaku untuk semua permintaan ke `/<sistem>/…` sampai diubah lagi). */
export async function setMockScenario(
  system: IntegrationTarget,
  mode: MockMode,
  opts: MockScenarioOptions = {},
): Promise<void> {
  await panel('POST', 'scenario', toPanelScenario(system, mode, opts));
}

/** Kosongkan keadaan mock: semua sistem normal, invoice, kotak masuk email/WhatsApp, echo outbox, dan log. */
export async function resetMockState(): Promise<void> {
  await panel('POST', 'reset', {});
}

export interface MockPanelState {
  systems: Array<{
    id: IntegrationTarget;
    scenario: { mode: PanelScenario['mode']; latencyMs: number; failStatus: number };
  }>;
  /** Pesan outbox contoh (`ping`) yang diterima, terbaru dulu (maks. 20). */
  echoes: Array<{ idempotencyKey: string; operation: string; receivedAt: string; count: number }>;
  /** Permintaan ke sistem mock, terbaru dulu (maks. 50). */
  log: Array<{
    at: string;
    system: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
  }>;
  /** Email/WhatsApp yang "terkirim", terbaru dulu (maks. 30). */
  messages: Array<{ id: string; channel: 'email' | 'whatsapp'; to: string; subject?: string; text: string }>;
}

/** Keadaan panel mock saat ini (untuk menunggu efek outbox, mis. pesan WhatsApp masuk). */
export function mockState(): Promise<MockPanelState> {
  return panel<MockPanelState>('GET', 'state');
}
