import { Global, Module } from '@nestjs/common';
import { LookupGateway } from './lookup.gateway';

/**
 * ADR-0025 · `LookupGateway` tersedia global. Konektor konkret (BPJS VClaim, Dukcapil) disuntikkan modul domain
 * yang memakainya (registrasi/SEP, potongan 5a), bukan di sini.
 */
@Global()
@Module({ providers: [LookupGateway], exports: [LookupGateway] })
export class LookupModule {}
