import type { IntegrationTarget } from '@simrs/shared';
import { E2E_MOCK_URL } from './slot';

/**
 * Kendali mock integrasi E2E lewat API panelnya (apps/mock/src/panel/panel.ts, daftar lengkap di apps/mock/README.md):
 * - `POST /_panel/api/scenario` `{ system, mode, latencyMs?, failStatus?, timeoutMs? }`
 * - `POST /_panel/api/reset` → `{ ok: true }` (skenario normal, invoice/kotak masuk/echo/log/BPJS kosong)
 * - `GET /_panel/api/state` → `{ systems, echoes, log, messages, invoices, bpjs, … }` (daftar dipotong: log 50,
 *   lainnya 20–30)
 *
 * Keadaan mock dipakai bersama SEMUA tes yang sedang berjalan (semua proyek dan worker Playwright). Tes yang mengubah
 * skenario: satu proyek saja, `test.describe.configure({ mode: 'serial' })`, sistem yang tidak dipakai tes paralel
 * lain, dan kembalikan ke `normal` di `afterEach`. `resetMockState()` juga menghapus data mock milik tes lain.
 */

/**
 * Gangguan per sistem yang bisa disimulasikan E2E:
 * - `lambat`: jeda sebelum diproses;
 * - `gagal`: ditolak HTTP `failStatus` tanpa diproses;
 * - `timeout`: permintaan DIPROSES (mis. SEP terbit), jawabannya ditahan sampai klien memutus (worker E2E: 2 dtk),
 *   seperti jawaban BPJS yang hilang di jalan.
 */
export type MockMode = 'normal' | 'lambat' | 'gagal' | 'timeout';

export interface MockScenarioOptions {
  /** Mode `lambat`: jeda per permintaan (bawaan 3000 ms). */
  latencyMs?: number;
  /** Mode `gagal`: kode HTTP (bawaan 503). */
  failStatus?: number;
  /** Mode `timeout`: lama jawaban ditahan sebelum 504 bila klien masih menunggu (bawaan 30000 ms). */
  timeoutMs?: number;
}

/**
 * Bentuk `POST /_panel/api/scenario`. Nilai lambat/gagal/timeout selalu dikirim eksplisit karena panel
 * mempertahankan nilai sebelumnya bila kosong.
 */
function toPanelScenario(system: IntegrationTarget, mode: MockMode, o: MockScenarioOptions) {
  switch (mode) {
    case 'normal':
      return { system, mode };
    case 'lambat':
      return { system, mode, latencyMs: o.latencyMs ?? 3000 };
    case 'gagal':
      return { system, mode, failStatus: o.failStatus ?? 503 };
    case 'timeout':
      return { system, mode, timeoutMs: o.timeoutMs ?? 30_000 };
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
    scenario: { mode: MockMode | 'acak'; latencyMs: number; failStatus: number; timeoutMs: number };
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

/**
 * Berapa kali mock E2E menerima pesan `ping` berkunci idempotensi ini (0 = belum). Membuktikan worker mengirim ke
 * mock slot ini, bukan ke mock pengembangan (:4100), yang tidak terlihat dari status pesan saja.
 */
export async function mockEchoCount(idempotencyKey: string): Promise<number> {
  const { echoes } = await mockState();
  return echoes.find((e) => e.idempotencyKey === idempotencyKey)?.count ?? 0;
}

export type LisTemplate = 'dl' | 'kimia' | 'elektrolit' | 'lipid';
export type LisScenario = 'normal' | 'kritis' | 'delta-kreatinin' | 'sebagian-tertunda';

export interface LisSendResult {
  controlId: string;
  barcode: string;
  /** ORU^R01 mentah yang dikirim (tanpa PID). */
  message: string;
  deliveries: Array<{
    attempt: number;
    status: number | 'error';
    ack: string | null;
    signatureValid: boolean;
  }>;
}

/**
 * Fase 4 §4.1b · Mock analyzer mengirim ORU^R01 ber-HMAC perangkat ke endpoint ingest SIM RS slot ini
 * (`LIS_HL7_TARGET`, disetel playwright.config.ts). Gangguan: `duplicate`, `badSignature`, `unknownBarcode`, `latencyMs`.
 */
export const mockLis = {
  send(
    barcode: string,
    template: LisTemplate,
    opts: {
      scenario?: LisScenario;
      duplicate?: boolean;
      badSignature?: boolean;
      unknownBarcode?: boolean;
      latencyMs?: number;
    } = {},
  ): Promise<LisSendResult> {
    return panel<LisSendResult>('POST', 'lis/send', { barcode, template, ...opts });
  },
  reset(): Promise<{ ok: true }> {
    return panel<{ ok: true }>('POST', 'lis/reset', {});
  },
};
