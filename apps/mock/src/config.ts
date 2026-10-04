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
