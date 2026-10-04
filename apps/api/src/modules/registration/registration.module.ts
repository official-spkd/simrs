import { Module } from '@nestjs/common';

/**
 * F03 · Registrasi dan admisi (rawat jalan, IGD, rawat inap). KERANGKA (fase 2 potongan 1b): sudah terdaftar di
 * `AppModule`, potongan 5a/7 cukup menambah controller/service/repository di folder ini.
 *
 * Isi nanti (potongan 5a, lalu 7 untuk IGD/admisi):
 * - Registrasi rawat jalan dengan `Idempotency-Key`: encounter, coverage, persetujuan umum, DPJP; SEP `pending` lewat
 *   modul `sep` (outbox). Menerbitkan `encounter.registered` / `encounter.cancelled` lewat `DomainEvents`.
 * - Lookup sinkron Dukcapil (isian demografi) dan eligibilitas: handler `@NoRequestTransaction()` + `LookupGateway`
 *   (ADR-0025) dengan konektor yang disuntikkan; tidak pernah di dalam transaksi permintaan.
 * - Kontak penanggung jawab (terenkripsi), relasi akses DPJP (`access_relationships`).
 * - Tes wajib: BPJS gagal → registrasi tetap 201 dan SEP `pending`.
 */
@Module({})
export class RegistrationModule {}
