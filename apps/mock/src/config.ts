import { envSchemas, parseEnv } from '@simrs/shared';
import { z } from 'zod';

export interface WebhookResult {
  status: number | 'error';
}

export type WebhookSender = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<WebhookResult>;

export interface MockConfig {
  port: number;
  /** Alamat bind; default loopback agar mock (tanpa autentikasi) tidak terbuka ke jaringan. */
  host: string;
  /** Kredensial BPJS yang diterima mock + kode PPK untuk nomor SPRI (permintaannya tidak membawa PPK). */
  bpjs: { consId: string; secretKey: string; userKey: string; ppkCode: string };
  tpdi: { apiKey: string; merchantId: string; webhookSecret: string; webhookTarget: string };
  /** Dapat diganti di tes. */
  sendWebhook: WebhookSender;
  now: () => Date;
  random: () => number;
}

export const fetchWebhookSender: WebhookSender = async (url, headers, body) => {
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
    return { status: res.status };
  } catch {
    return { status: 'error' };
  }
};

const schema = envSchemas.mock.extend(envSchemas.host.shape).extend({
  TPDI_API_KEY: z.string().min(1).default('mock-tpdi-key'),
  TPDI_MERCHANT_ID: z.string().min(1).default('TPDI-RS-00127'),
  BPJS_USER_KEY: z.string().min(1).default('mock-user-key'),
  BPJS_PPK_CODE: z
    .string()
    .regex(/^[0-9A-Z]{8}$/)
    .default('0301R001'),
});

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Mock tidak berautentikasi dan memakai kredensial/rahasia mock bawaan: hanya untuk mesin pengembang, tes, dan E2E.
 * Menolak start di produksi (APP_ENV atau NODE_ENV) dan bind ke luar loopback kecuali `MOCK_ALLOW_REMOTE=true`
 * (mis. kontainer jaringan tertutup). APP_ENV kosong tetap diizinkan (tes, `pnpm start` tanpa .env). Demo publik
 * (`APP_ENV=demo`) berjalan dengan build produksi (`NODE_ENV=production`) tetapi wajib memakai mock, jadi diizinkan.
 */
export function mockStartupProblem(env: Record<string, string | undefined>): string | null {
  if (env.APP_ENV === 'production' || (env.NODE_ENV === 'production' && env.APP_ENV !== 'demo')) {
    return 'Mock integrasi tidak boleh berjalan di produksi (APP_ENV/NODE_ENV=production)';
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!LOOPBACK.has(host) && env.MOCK_ALLOW_REMOTE !== 'true') {
    return `Mock integrasi hanya bind ke loopback (HOST=${host}); setel MOCK_ALLOW_REMOTE=true bila sengaja`;
  }
  return null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): MockConfig {
  const e = parseEnv(schema, {
    MOCK_PORT: '4100',
    TPDI_WEBHOOK_SECRET: 'mock-tpdi-webhook-secret',
    TPDI_WEBHOOK_TARGET: 'http://localhost:4000/api/v1/webhooks/tpdi',
    BPJS_CONS_ID: '10000',
    BPJS_SECRET_KEY: 'mock-secret',
    ...env,
  });
  return {
    port: e.MOCK_PORT,
    host: e.HOST,
    bpjs: {
      consId: e.BPJS_CONS_ID,
      secretKey: e.BPJS_SECRET_KEY,
      userKey: e.BPJS_USER_KEY,
      ppkCode: e.BPJS_PPK_CODE,
    },
    tpdi: {
      apiKey: e.TPDI_API_KEY,
      merchantId: e.TPDI_MERCHANT_ID,
      webhookSecret: e.TPDI_WEBHOOK_SECRET,
      webhookTarget: e.TPDI_WEBHOOK_TARGET,
    },
    sendWebhook: fetchWebhookSender,
    now: () => new Date(),
    random: Math.random,
  };
}
