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
