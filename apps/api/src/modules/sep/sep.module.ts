import { Module } from '@nestjs/common';

/**
 * F06 · Penjaminan dan eligibilitas: SEP, SPRI, rencana kontrol, cek peserta/rujukan. KERANGKA (fase 2 potongan 1b):
 * sudah terdaftar di `AppModule`, potongan 5a/7 cukup menambah controller/service/repository di folder ini.
 *
 * Isi nanti:
 * - Cek peserta dan rujukan VClaim secara sinkron: handler `@NoRequestTransaction()` + `LookupGateway.lookup()` dengan
 *   konektor dari klien BPJS bersama (`@simrs/shared/node`), batas 5 dtk → 503 `BPJS_UNAVAILABLE` (ADR-0025).
 * - SEP berversi dan beku setelah `issued`; penerbitan/batal/kirim ulang SELALU lewat outbox (bukan lookup), dengan
 *   pemeriksaan SEP yang sudah ada sebelum mengirim ulang. Event `sep.issued` saat hasil diproses.
 * - SPRI dan rencana kontrol (potongan 7). Izin `coverage.read|write`.
 */
@Module({})
export class SepModule {}
