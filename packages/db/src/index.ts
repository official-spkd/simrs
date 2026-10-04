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
  deferOutboxMessage,
  enqueueOutbox,
  OUTBOX_LEASE_MS,
  recordOutboxAttempt,
  type AttemptResult,
  type RecordAttemptOptions,
} from './outbox';
export type { AuditEvent, InboundEvent, OutboxMessage, Tenant } from './generated/prisma/client';
export { allocateNumber, isModuleEnabled, readTenantSetting, type AllocatedNumber } from './platform';
export {
  activeAssignments,
  ensureSystemRoles,
  lockTenantScope,
  ROLE_MATRIX_LOCK,
  roleGrants,
  roleGrantScope,
} from './authz';
export {
  CODE_PERMISSION_CATALOG,
  type PermissionSyncCatalog,
  type PermissionSyncReport,
  syncRolePermissions,
} from './permission-sync';
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
  SEED_STAFF,
  SEED_STAFF_VALID_FROM,
  SEED_UNITS,
  type SeedStaffMember,
  seedStaffPhone,
} from './seed-data';
export { seedStaff, type SeedStaffResult } from './seed-staff';
export { seedHospitalStructure } from './seed-structure';
export {
  allocateQueueNumber,
  type AllocatedQueueNumber,
  QUEUE_NUMBER_MAX,
  type QuotaBucket,
  type QuotaState,
  releaseQuota,
  reserveQuota,
} from './front-office';
export {
  SEED_PAYERS,
  SEED_PRACTITIONERS,
  SEED_QUEUE_DISPLAYS,
  SEED_QUEUE_SERVICES,
  SEED_SCHEDULE_TEMPLATES,
  seedFrontOffice,
  type SeedFrontOfficeResult,
  seedPractitionerNumbers,
} from './seed-front-office';
export {
  PRESENTATION_PERSONAS,
  PRESENTATION_USERNAME_PREFIX,
  type PresentationCredential,
  upsertPresentationAccounts,
} from './presentation';
