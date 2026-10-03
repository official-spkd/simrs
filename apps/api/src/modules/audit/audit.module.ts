import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/** P04 · Jejak audit: daftar, verifikasi rantai. Layar + anomali di potongan 6. */
@Module({ controllers: [AuditController], providers: [AuditService, AuditRepository] })
export class AuditModule {}
