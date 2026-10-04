import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MockConfig } from '../config';
import { SCENARIO_MODES, SYSTEM_LABEL, SYSTEMS, type MockState } from '../state';
import { bpjsPanelSummary, registerBpjsPanel } from '../systems/bpjs/panel';
import { deliverTpdiWebhook } from '../systems/tpdi';
import { PANEL_HTML } from './html';

const scenarioSchema = z.object({
  system: z.enum(SYSTEMS),
  mode: z.enum(SCENARIO_MODES),
  latencyMs: z.number().int().min(0).max(60_000).optional(),
  failStatus: z.number().int().min(400).max(599).optional(),
  timeoutMs: z.number().int().min(0).max(120_000).optional(),
});

const resetSchema = z.object({ system: z.enum(SYSTEMS).optional() }).optional();

/**
 * Panel kendali mock (docs/06 §7) + API-nya di `/_panel/api/*` (dipakai juga helper E2E):
 *
 * - `GET  /_panel/api/state`    → skenario per sistem, enkripsi BPJS, tagihan TPDI, _echo, log, pesan, ringkasan BPJS
 * - `POST /_panel/api/scenario` → `{ system, mode: normal|lambat|gagal|acak|timeout, latencyMs?, failStatus?,
 *                                  timeoutMs? }` → skenario baru; nilai yang tidak dikirim tetap
 * - `POST /_panel/api/reset`    → body kosong = reset semua; `{ system }` = reset satu sistem (skenario + data)
 * - `POST /_panel/api/bpjs-encryption` → `{ enabled }`
 * - BPJS: lihat `systems/bpjs/panel.ts`; TPDI: `POST /_panel/api/tpdi/invoices/:id/(pay|resend|expire)`
 */
export function registerPanel(app: FastifyInstance, config: MockConfig, state: MockState): void {
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(PANEL_HTML));

  app.get('/_panel/api/state', async () => ({
    systems: SYSTEMS.map((s) => ({ id: s, label: SYSTEM_LABEL[s], scenario: state.scenario(s) })),
    bpjsEncryption: state.bpjsEncryption,
    webhookTarget: config.tpdi.webhookTarget,
    invoices: [...state.invoices.values()].reverse().slice(0, 20),
    echoes: [...state.echoes.values()].reverse().slice(0, 20),
    log: state.log,
    messages: state.messages.slice(0, 30),
    bpjs: bpjsPanelSummary(state.bpjs, 20),
  }));

  app.post('/_panel/api/scenario', async (req, reply) => {
    const parsed = scenarioSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'Skenario tidak valid' });
    const cur = state.scenario(parsed.data.system);
    state.scenarios.set(parsed.data.system, {
      mode: parsed.data.mode,
      latencyMs: parsed.data.latencyMs ?? cur.latencyMs,
      failStatus: parsed.data.failStatus ?? cur.failStatus,
      timeoutMs: parsed.data.timeoutMs ?? cur.timeoutMs,
    });
    return state.scenario(parsed.data.system);
  });

  app.post<{ Body: { enabled?: boolean } }>('/_panel/api/bpjs-encryption', async (req) => {
    state.bpjsEncryption = req.body?.enabled !== false;
    return { bpjsEncryption: state.bpjsEncryption };
  });

  app.post('/_panel/api/reset', async (req, reply) => {
    const parsed = resetSchema.safeParse(req.body ?? undefined);
    if (!parsed.success)
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'Sistem tidak dikenal' });
    const system = parsed.data?.system;
    if (system) state.resetSystem(system);
    else state.reset();
    return { ok: true, system: system ?? 'semua' };
  });

  registerBpjsPanel(app, config, state);

  app.post<{ Params: { id: string; action: string }; Body: { amountOverride?: number } | undefined }>(
    '/_panel/api/tpdi/invoices/:id/:action',
    async (req, reply) => {
      const inv = state.invoices.get(req.params.id);
      if (!inv) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Invoice tidak ditemukan' });
      switch (req.params.action) {
        case 'pay': {
          if (inv.status !== 'pending') {
            return reply.code(409).send({ code: 'CONFLICT', message: `Invoice berstatus ${inv.status}` });
          }
          inv.status = 'paid';
          inv.paidAt = config.now().toISOString();
          inv.bankRef = `BTN${randomBytes(5).toString('hex').toUpperCase()}`;
          return deliverTpdiWebhook(config, inv, 'payment.paid');
        }
        case 'resend': {
          // Callback ganda: event id sama dengan pengiriman terakhir, menguji idempotensi SIM RS.
          const last = inv.webhookDeliveries[0];
          if (!last)
            return reply
              .code(409)
              .send({ code: 'CONFLICT', message: 'Belum ada webhook untuk dikirim ulang' });
          return deliverTpdiWebhook(config, inv, last.event as Parameters<typeof deliverTpdiWebhook>[2], {
            eventId: last.eventId,
          });
        }
        case 'expire': {
          if (inv.status !== 'pending') {
            return reply.code(409).send({ code: 'CONFLICT', message: `Invoice berstatus ${inv.status}` });
          }
          inv.status = 'expired';
          return deliverTpdiWebhook(config, inv, 'payment.expired');
        }
        default:
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Aksi tidak dikenal' });
      }
    },
  );
}
