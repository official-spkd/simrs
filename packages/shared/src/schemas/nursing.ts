import { z } from 'zod';
import { clinicalEntryMetaSchema, clinicalRevisionSchema } from './klinis';
import { emarOrderSchema, emarScheduleSlotSchema, medicationAdministrationInputSchema } from './rawat-inap';

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();

export const emarQuerySchema = z.strictObject({ date: date.optional() });
export const medicationDoubleCheckInputSchema = z
  .strictObject(medicationAdministrationInputSchema.shape)
  .omit({ doubleCheckUserId: true, doubleCheckId: true })
  .extend({ status: z.literal('given') });
export type MedicationDoubleCheckInput = z.infer<typeof medicationDoubleCheckInputSchema>;
export const medicationAdministrationRecordSchema = emarScheduleSlotSchema.shape.administration
  .unwrap()
  .extend({ medicationRequestId: uuid, scheduleId: uuid.nullable(), scanId: uuid, labelCode: z.string() });
export type MedicationAdministrationRecord = z.infer<typeof medicationAdministrationRecordSchema>;
export const emarBoardSchema = z.strictObject({
  encounterId: uuid,
  date,
  orders: z.array(emarOrderSchema),
  administrations: z.array(medicationAdministrationRecordSchema),
});
export type EmarBoard = z.infer<typeof emarBoardSchema>;

export const nursingCarePlanInputSchema = z.strictObject({
  encounterId: uuid,
  diagnosisId: uuid,
  goals: z.string().trim().min(1).max(2000),
  interventions: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  evaluation: z.string().trim().min(1).max(2000).nullable(),
  occurredAt: instant,
  revision: clinicalRevisionSchema,
});
export type NursingCarePlanInput = z.infer<typeof nursingCarePlanInputSchema>;
export const nursingCarePlanRecordSchema = clinicalEntryMetaSchema.extend({
  encounterId: uuid,
  diagnosisId: uuid,
  diagnosis: z.string(),
  goals: z.string(),
  interventions: z.array(z.string()),
  evaluation: z.string().nullable(),
});
export type NursingCarePlanRecord = z.infer<typeof nursingCarePlanRecordSchema>;
export const fluidBalanceInputSchema = z.strictObject({
  encounterId: uuid,
  direction: z.enum(['intake', 'output']),
  route: z.string().trim().min(1).max(120),
  volumeMl: z.number().positive().max(100_000),
  note: z.string().trim().max(500).nullable(),
  occurredAt: instant,
  revision: clinicalRevisionSchema,
});
export type FluidBalanceInput = z.infer<typeof fluidBalanceInputSchema>;
