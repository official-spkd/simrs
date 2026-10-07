import { z } from 'zod';

import { GRAM_RESULTS } from './penunjang-mikro';

import { REACTION_SIGNS } from './penunjang-bank-darah';

import { ASA_CLASSES } from './penunjang-anestesi';

import { CHECKLIST_PHASES, checklistPhaseSchema } from '@simrs/shared';

import { OVERRIDE_REASON_MIN } from './penunjang-ok';

export const bloodInput = (() => {
  const id = z.string().min(1).max(40);
  const name = z.string().max(120);
  const abo = z.enum(['O', 'A', 'B', 'AB']);
  const rh = z.enum(['+', '-']);
  const vitals = z.strictObject({
    tempC: z.number().min(30).max(43),
    systolic: z.number().int().min(40).max(260),
    diastolic: z.number().int().min(20).max(160),
    pulse: z.number().int().min(20).max(250),
  });

  return z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('terima'), requestId: id }),
    z.strictObject({ type: z.literal('golongan'), requestId: id, abo, rh }),
    z.strictObject({
      type: z.literal('crossmatch'),
      requestId: id,
      unitId: id,
      result: z.enum(['kompatibel', 'inkompatibel']),
      group: z.strictObject({ abo, rh }),
    }),
    z.strictObject({
      type: z.literal('keluarkan'),
      requestId: id,
      unitId: id,
      first: name,
      second: name,
      items: z.record(z.string().max(20), z.boolean()),
      group: z.strictObject({ abo, rh }),
    }),
    z.strictObject({
      type: z.literal('pasang'),
      requestId: id,
      wristband: z.string().max(40),
      bag: z.string().max(40),
      manual: z
        .strictObject({ reason: z.string().max(300), secondVerifier: name, identityConfirmed: z.boolean() })
        .optional(),
      baseline: vitals,
    }),
    z.strictObject({
      type: z.literal('ttv'),
      requestId: id,
      label: z.string().max(40),
      vitals,
      signs: z.array(z.enum(REACTION_SIGNS)).max(REACTION_SIGNS.length),
    }),
    z.strictObject({ type: z.literal('selesai'), requestId: id }),
  ]);
})();

export const nutritionInput = (() => {
  const id = z.string().min(1).max(40);
  const meal = z.enum(['pagi', 'siang', 'sore']);

  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('verifikasi'), orderId: id, screened: z.boolean() }),
    z.strictObject({
      kind: z.literal('skrining'),
      orderId: id,
      weightLoss: z.enum(['tidak', 'tidak-yakin', '1-5', '6-10', '11-15', '>15']),
      poorAppetite: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal('antar'),
      orderId: id,
      meal,
      substituted: z.boolean(),
      overrideReason: z.string().max(300).nullable(),
      verified: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal('terima'),
      orderId: id,
      meal,
      leftover: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)]),
    }),
  ]);
})();

export const microInput = (() => {
  const id = z.string().min(1).max(40);
  const gram = z.enum(GRAM_RESULTS);
  const text = z.string().max(2000);

  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pertumbuhan'), caseId: id, grew: z.boolean() }),
    z.strictObject({ kind: z.literal('gram'), caseId: id, result: gram }),
    z.strictObject({ kind: z.literal('identifikasi'), caseId: id, gram, organism: z.string().max(80) }),
    z.strictObject({
      kind: z.literal('kepekaan'),
      caseId: id,
      gram,
      results: z.record(z.string().max(40), z.enum(['S', 'I', 'R'])),
    }),
    z.strictObject({ kind: z.literal('final'), caseId: id }),
    z.strictObject({ kind: z.literal('pa-tte'), caseId: id, macro: text, micro: text, diagnosis: text }),
    z.strictObject({ kind: z.literal('pa-addendum'), caseId: id, text }),
  ]);
})();

export const diagnosticInput = (() => {
  const id = z.string().min(1).max(40);

  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('jadwal'), orderId: id, slot: z.string().max(80) }),
    z.strictObject({ kind: z.literal('laksana'), orderId: id, identityConfirmed: z.boolean() }),
    z.strictObject({
      kind: z.literal('tte'),
      orderId: id,
      findings: z.record(z.string().max(60), z.string().max(1000)),
      critical: z.boolean(),
    }),
  ]);
})();

export const anesthesiaInput = (() => {
  const caseId = z.uuid();
  const pre = z.strictObject({
    asa: z.enum(ASA_CLASSES).nullable(),
    emergency: z.boolean(),
    fastingSince: z.string().max(10),
    airway: z.string().max(40),
    plan: z.string().max(500),
    consent: z.boolean(),
  });

  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('tte'), caseId, pre }),
    z.strictObject({
      kind: z.literal('induksi'),
      caseId,
      preSigned: z.boolean(),
      signInConfirmed: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal('ttv'),
      caseId,
      vitals: z.strictObject({
        systolic: z.number().int().min(30).max(260),
        diastolic: z.number().int().min(10).max(160),
        pulse: z.number().int().min(20).max(250),
        spo2: z.number().int().min(50).max(100),
        etco2: z.number().int().min(5).max(90),
      }),
    }),
  ]);
})();

export const operatingInput = (() => {
  const caseId = z.uuid();
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('konfirmasi'), caseId, phase: z.enum(CHECKLIST_PHASES) }),
    // Bukti time out: daftar tilik efektif layar saat insisi dicatat (diperiksa terhadap kasus di server).
    z.strictObject({ kind: z.literal('insisi'), caseId, checklist: z.array(checklistPhaseSchema).length(3) }),
    z.strictObject({
      kind: z.literal('override'),
      caseId,
      reason: z
        .string()
        .trim()
        .min(OVERRIDE_REASON_MIN, `Alasan klinis wajib, minimal ${OVERRIDE_REASON_MIN} karakter.`)
        .max(500),
    }),
    z.strictObject({ kind: z.literal('selesai'), caseId }),
    z.strictObject({ kind: z.literal('pulih'), caseId }),
  ]);
})();
