import { z } from 'zod';
import { FHIR_SCOPES } from './integrasi-api-publik';
import { dlqResendInputSchema } from '@simrs/shared';

export const satusehatInput = (() => {
  const id = z.string().min(1).max(80);
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ihs'), visitId: id }),
    z.strictObject({ kind: z.literal('kirim'), visitId: id, resourceId: id, confirmed: z.literal(true) }),
    z.strictObject({ kind: z.literal('petakan'), visitId: id, resourceId: id }),
    z.strictObject({
      kind: z.literal('kirim-ulang'),
      visitId: id,
      resourceId: id,
      confirmed: z.literal(true),
      fixed: z.strictObject({ ihs: z.boolean(), loinc: z.boolean(), kfa: z.boolean() }),
    }),
  ]);
})();

export const bpjsInput = (() => {
  return z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('task'),
      bookingCode: z.string().regex(/^\d{10}$/),
      confirmed: z.literal(true),
    }),
    z.strictObject({ kind: z.literal('aplicare') }),
    z.strictObject({ kind: z.literal('hfis'), doctor: z.string().max(120) }),
    z.strictObject({ kind: z.literal('downtime-mulai'), reason: z.string().max(300) }),
    z.strictObject({ kind: z.literal('downtime-akhiri'), backlog: z.number().int().min(0).max(10_000) }),
  ]);
})();

export const kemenkesInput = (() => {
  const id = z.string().min(1).max(80);
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('perbaiki'), reportId: id, checkId: id }),
    z.strictObject({
      kind: z.literal('kirim'),
      reportId: id,
      confirmed: z.literal(true),
      fixedChecks: z.array(id).max(20),
    }),
  ]);
})();

export const apiInput = (() => {
  const id = z.string().min(1).max(80);
  return z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('daftar'),
      name: z.string().max(120),
      purpose: z.string().max(300),
      scopes: z.array(z.enum(FHIR_SCOPES)).max(FHIR_SCOPES.length),
      basis: z.string().max(300),
    }),
    z.strictObject({ kind: z.literal('rotasi'), clientId: id, confirmed: z.literal(true) }),
    z.strictObject({ kind: z.literal('tangguhkan'), clientId: id, reason: z.string().max(300) }),
    z.strictObject({ kind: z.literal('aktifkan'), clientId: id }),
  ]);
})();

export const integrationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('satusehat.aksi'), input: satusehatInput }),
  z.strictObject({ type: z.literal('bpjs.aksi'), input: bpjsInput }),
  z.strictObject({
    type: z.literal('bpjs.tunda'),
    kind: z.enum(['SEP', 'Task ID', 'Aplicare']),
    label: z.string().max(180),
  }),
  z.strictObject({ type: z.literal('kemenkes.aksi'), input: kemenkesInput }),
  z.strictObject({ type: z.literal('api.aksi'), input: apiInput }),
  z.strictObject({
    type: z.literal('gateway.terima'),
    raw: z
      .string()
      .min(1)
      .max(64 * 1024),
  }),
  z.strictObject({ type: z.literal('hub.kirim-ulang'), input: dlqResendInputSchema }),
  z.strictObject({ type: z.literal('hub.mulai') }),
  z.strictObject({ type: z.literal('hub.detak') }),
  z.strictObject({ type: z.literal('hub.pulih') }),
]);
export type IntegrationEvent = z.infer<typeof integrationEventSchema>;
