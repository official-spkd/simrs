export {
  createPrismaClient,
  isTenantRequiredError,
  knownDbError,
  raisedDbCode,
  uniqueViolationTarget,
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
export {
  auditChainHead,
  type AuditAnchorRow,
  type AuditChainSegment,
  type AuditTrailIssue,
  type AuditTrailVerification,
  databaseNow,
  latestValidAuditAnchor,
  listAuditAnchors,
  prepareAuditAnchor,
  type PreparedAuditAnchor,
  recordAuditAnchor,
  verifyAuditChainFrom,
  verifyAuditTrail,
} from './audit-anchor';
export {
  AUDIT_MAX_FINDINGS_PER_KIND,
  AUDIT_PATIENT_READ_ACTIONS,
  AUDIT_PATIENT_VOLUME_ACTIONS,
  AUDIT_SUMMARY_VERSION,
  auditAnomalyBuckets,
  type AuditAnomalyBuckets,
  type AuditAnomalySettings,
  auditBurstBuckets,
  type AuditDayBucket,
  auditNightBuckets,
  auditSummaryParams,
  auditConfidentialBuckets,
  auditVolumeBuckets,
  type NightWindow,
  pendingAuditSummaryDays,
  readAuditAnomalySettings,
  summarizeAuditDay,
  wibDayRange,
} from './audit-anomaly';
export { allocateNumber, isModuleEnabled, readTenantSetting, type AllocatedNumber } from './platform';
export {
  addIsoDays,
  dbDateFromIso,
  dbTimeFromHhmm,
  enqueueHfisPull,
  generateScheduleSessions,
  type GenerateSessionsResult,
  hhmmFromDbTime,
  isoFromDbDate,
  isoWeekday,
} from './scheduling';
export { readBackupStatus } from './backup';
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
  type PermissionReconcileReport,
  type PermissionSyncCatalog,
  type PermissionSyncReport,
  reconcileRolePermissions,
  type RoleGrantDiff,
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
export {
  BREACHED_TOP_DEFAULT,
  BREACHED_TOP_MAX,
  type BreachedCollectResult,
  type BreachedEntry,
  type BreachedListStatus,
  breachedListStatus,
  collectBreachedPasswords,
  isBreachedPassword,
  passwordSha1,
  replaceBreachedPasswords,
  sha1PrefixRange,
} from './breached-passwords';
export { seedRefSamples, SEED_REF_SAMPLES, SEED_REF_VERSION } from './seed-ref';
export { ensurePublishedForm, upgradePublishedForm } from './forms';
export {
  SEED_STAFF,
  SEED_STAFF_VALID_FROM,
  SEED_UNITS,
  type SeedStaffMember,
  seedStaffPhone,
} from './seed-data';
export { seedStaff, type SeedStaffResult } from './seed-staff';
export {
  SEED_LAB_TESTS,
  SEED_WHO_CHECKLIST,
  seedSupportMasters,
  seedSupportStock,
  type SeedSupportResult,
} from './seed-support';
export { seedHospitalStructure } from './seed-structure';
export {
  SEED_DRUGS,
  SEED_FORM_PACKAGES,
  SEED_NURSING_DIAGNOSES,
  SEED_ORDER_SETS,
  SEED_ORDERABLES,
  SEED_SUBSTANCES,
  seedClinicalHistory,
  seedClinicalMasters,
  type SeedClinicalResult,
} from './seed-clinical';
export {
  allocateQueueNumber,
  insertBpjsQueueTask,
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
  PRESENTATION_ALL_ACCESS_LABEL,
  PRESENTATION_PERSONAS,
  PRESENTATION_USERNAME_PREFIX,
  type PresentationCredential,
  upsertPresentationAccounts,
} from './presentation';
export { rekeySurvivorSnapshot, type SurvivorSnapshot } from './patient-snapshot';
export {
  type ColumnKeyUsage,
  KEY_ROTATION_TARGETS,
  type KeyRotationBatch,
  KeyRotationBlockedError,
  type KeyRotationOptions,
  type KeyRotationProblem,
  type KeyRotationTarget,
  listKeyRotationTenantIds,
  planTenantKeyRotation,
  revokePinsOnRetiredKeys,
  rotateTenantKeys,
  type TargetPlan,
  type TargetRunReport,
  type TenantKeyPlan,
  type TenantKeyRotationReport,
} from './key-rotation';
