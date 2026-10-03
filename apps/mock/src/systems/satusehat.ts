import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MockConfig } from '../config';
import { fakeIhs, isNik } from '../fixtures';

const NIK_SYSTEM = 'https://fhir.kemkes.go.id/id/nik';
/** Resource yang tidak wajib mereferensikan Encounter. */
const NO_ENCOUNTER = new Set([
  'Encounter',
  'Organization',
  'Location',
  'Patient',
  'Practitioner',
  'AllergyIntolerance',
]);
const NO_SUBJECT = new Set(['Organization', 'Location', 'Patient', 'Practitioner']);

function outcome(status: number, diagnostics: string) {
  return {
    status,
    body: {
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'invariant', diagnostics }],
    },
  };
}

/** Mock SATUSEHAT (docs/06 §4): token OAuth2, lookup IHS by NIK, POST resource dengan validasi minimal. */
export function registerSatusehat(app: FastifyInstance, _config: MockConfig): void {
  const tokens = new Map<string, number>();

  app.post<{ Querystring: { grant_type?: string } }>(
    '/satusehat/oauth2/v1/accesstoken',
    async (req, reply) => {
      if (req.query.grant_type !== 'client_credentials') {
        return reply.code(400).send({ error: 'unsupported_grant_type' });
      }
      const token = randomBytes(24).toString('base64url');
      tokens.set(token, Date.now() + 3600_000);
      return {
        access_token: token,
        token_type: 'BearerToken',
        expires_in: '3599',
        issued_at: String(Date.now()),
      };
    },
  );

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/satusehat/fhir-r4/')) return;
    const auth = req.headers.authorization ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const exp = tokens.get(token);
    if (!exp || exp < Date.now()) {
      const o = outcome(401, 'Token tidak valid atau kedaluwarsa');
      return reply.code(o.status).send(o.body);
    }
  });

  app.get<{ Querystring: { identifier?: string } }>('/satusehat/fhir-r4/v1/Patient', async (req) => {
    const [system, value] = (req.query.identifier ?? '').split('|');
    const entry =
      system === NIK_SYSTEM && value && isNik(value)
        ? [
            {
              resource: {
                resourceType: 'Patient',
                id: fakeIhs(value),
                identifier: [{ system: NIK_SYSTEM, value }],
              },
            },
          ]
        : [];
    return { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry };
  });

  app.post<{ Params: { resourceType: string }; Body: Record<string, unknown> }>(
    '/satusehat/fhir-r4/v1/:resourceType',
    async (req, reply) => {
      const { resourceType } = req.params;
      const body = req.body ?? {};
      if (body.resourceType !== resourceType) {
        const o = outcome(422, `resourceType harus ${resourceType}`);
        return reply.code(o.status).send(o.body);
      }
      if (!NO_SUBJECT.has(resourceType) && !body.subject && !body.patient) {
        const o = outcome(422, `${resourceType}.subject wajib diisi`);
        return reply.code(o.status).send(o.body);
      }
      if (!NO_ENCOUNTER.has(resourceType) && !body.encounter && !body.context) {
        const o = outcome(422, `${resourceType}.encounter wajib diisi`);
        return reply.code(o.status).send(o.body);
      }
      return reply
        .code(201)
        .send({ ...body, id: randomUUID(), meta: { versionId: '1', lastUpdated: new Date().toISOString() } });
    },
  );
}
