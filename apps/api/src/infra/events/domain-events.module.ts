import { Global, Module } from '@nestjs/common';
import { DomainEvents } from './domain-events';

/** Penerbit event domain sinkron (dalam transaksi), tersedia global untuk semua modul. */
@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
