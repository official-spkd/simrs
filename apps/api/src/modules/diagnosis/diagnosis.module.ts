import { Module } from '@nestjs/common';

/**
 * K08 · Diagnosis ICD-10, prosedur ICD-9-CM, problem list, alergi + NKDA.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.2a tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class DiagnosisModule {}
