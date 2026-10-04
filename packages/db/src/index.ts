export {
  createPrismaClient,
  isTenantRequiredError,
  knownDbError,
  type KnownDbError,
  listActiveTenantIds,
  resolveTenantByCode,
  resolveTenantByHost,
  Prisma,
  PrismaClient,
  withTenant,
  verifyAuditChain,
  type AuditChainResult,
  type CreateClientOptions,
  type TenantTx,
} from './client';
export {
  claimDueOutbox,
  enqueueOutbox,
  OUTBOX_LEASE_MS,
  recordOutboxAttempt,
  type AttemptResult,
} from './outbox';
export type { AuditEvent, InboundEvent, OutboxMessage, Tenant } from './generated/prisma/client';
export { allocateNumber, isModuleEnabled, readTenantSetting, type AllocatedNumber } from './platform';
export { activeAssignments, ensureSystemRoles, lockTenantScope, roleGrantScope } from './authz';
export { insertPatient, toDbDate, type NewPatientRecord } from './patients';
export { detectDuplicates, loadMatchProfiles, lockMpi, type DetectResult } from './patient-match';
export { csvRecords, parseCsv, type CsvRecord } from './csv';
export {
  getConcept,
  importConcepts,
  importRegions,
  listCodeSystems,
  listRegions,
  searchConcepts,
  type ImportOptions,
  type ImportReport,
  type RefConcept,
  type RefRegion,
  type RefSystemInfo,
} from './ref';
export { seedRefSamples, SEED_REF_SAMPLES, SEED_REF_VERSION } from './seed-ref';
export { ensurePublishedForm } from './forms';
export {
  PRESENTATION_PERSONAS,
  PRESENTATION_USERNAME_PREFIX,
  type PresentationCredential,
  upsertPresentationAccounts,
} from './presentation';
