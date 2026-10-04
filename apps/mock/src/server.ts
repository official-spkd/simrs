import Fastify, { type FastifyInstance } from 'fastify';
import type { MockConfig } from './config';
import { registerPanel } from './panel/panel';
import { SYSTEMS, type MockState, type MockSystem } from './state';
import { registerBpjs } from './systems/bpjs';
import { registerBtn } from './systems/btn';
import { registerDukcapil } from './systems/dukcapil';
import { registerEklaim } from './systems/eklaim';
import { registerMessaging } from './systems/messaging';
import { registerSatusehat } from './systems/satusehat';
import { registerTpdi } from './systems/tpdi';
import { registerTte } from './systems/tte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function systemOf(url: string): MockSystem | undefined {
  const seg = url.split('?')[0]?.split('/')[1];
  return SYSTEMS.find((s) => s === seg);
}

export function buildServer(config: MockConfig, state: MockState): FastifyInstance {
  const app = Fastify({ logger: false });

  // Skenario per sistem: normal, lambat, gagal, acak (docs/06 §7).
  app.addHook('onRequest', async (req, reply) => {
    const system = systemOf(req.url);
    if (!system) return;
    const sc = state.scenario(system);
    const fail = () =>
      reply.code(sc.failStatus).send({ code: 'MOCK_FAILURE', message: `Skenario gagal ${system} (mock)` });
    if (sc.mode === 'lambat') await sleep(sc.latencyMs);
    if (sc.mode === 'gagal') return fail();
    if (sc.mode === 'acak') {
      if (config.random() < 0.3) return fail();
      await sleep(Math.round(config.random() * sc.latencyMs));
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/_panel') || req.url === '/' || req.url === '/favicon.ico') return;
    state.record({
      at: config.now().toISOString(),
      system: systemOf(req.url) ?? 'panel',
      method: req.method,
      path: req.url.split('?')[0] ?? req.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  // Titik terima generik untuk pesan outbox contoh (fase 0): dedup per Idempotency-Key.
  app.post<{ Params: { system: string }; Body: { operation?: string } | undefined }>(
    '/:system/_echo',
    async (req, reply) => {
      const system = systemOf(req.url);
      if (!system) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Sistem tidak dikenal' });
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length === 0) {
        return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'Header Idempotency-Key wajib' });
      }
      const mapKey = `${system}:${key}`;
      const existing = state.echoes.get(mapKey);
      if (existing) {
        existing.count += 1;
        return { received: true, duplicate: true, count: existing.count };
      }
      state.echoes.set(mapKey, {
        idempotencyKey: key,
        operation: req.body?.operation ?? 'unknown',
        receivedAt: config.now().toISOString(),
        count: 1,
      });
      return { received: true, duplicate: false, count: 1 };
    },
  );

  registerBpjs(app, config, state);
  registerEklaim(app);
  registerSatusehat(app, config);
  registerDukcapil(app);
  registerTte(app, config);
  registerTpdi(app, config, state);
  registerBtn(app, config, state);
  registerMessaging(app, config, state);
  registerPanel(app, config, state);

  return app;
}
