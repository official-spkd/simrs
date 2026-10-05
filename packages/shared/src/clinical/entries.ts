/**
 * Pola entri klinis berversi (ADR-0004, ADR-0028): aturan murni yang dipakai `ClinicalRecordService` (API) dan
 * pratinjau web. Database menegakkan invarian yang sama (CHECK, UNIQUE `supersedes_id`, trigger `app_clinical_guard`).
 */

/** Waktu kejadian boleh sedikit di depan jam server (jam perangkat berbeda), selebihnya ditolak. */
export const CLINICAL_FUTURE_TOLERANCE_MINUTES = 5;

/** Entri terlambat (MRMIK 8b): waktu catat lebih dari `lateHours` sesudah waktu kejadian. */
export function isLateEntry(
  occurredAt: Date | string,
  recordedAt: Date | string,
  lateHours: number,
): boolean {
  return new Date(recordedAt).getTime() - new Date(occurredAt).getTime() > lateHours * 3_600_000;
}

/** Waktu kejadian di masa depan (lebih dari toleransi) tidak sah. */
export function occurredInFuture(occurredAt: Date | string, recordedAt: Date | string): boolean {
  return (
    new Date(occurredAt).getTime() - new Date(recordedAt).getTime() >
    CLINICAL_FUTURE_TOLERANCE_MINUTES * 60_000
  );
}

/** Versi baru rantai koreksi: selalu versi pendahulu + 1, akar tetap. */
export function nextVersion(prev: { id: string; rootId: string; version: number }): {
  rootId: string;
  version: number;
  supersedesId: string;
} {
  return { rootId: prev.rootId, version: prev.version + 1, supersedesId: prev.id };
}
