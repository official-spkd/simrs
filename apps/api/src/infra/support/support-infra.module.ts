import { Module } from '@nestjs/common';
import { SupportStreamsController } from './support-streams.controller';

/**
 * Fase 4 §4.1a · Infrastruktur penunjang bersama: aliran SSE (worklist lab, antrean depo, papan OK, nilai kritis).
 * `SseService` dan `TenantDb` disediakan modul global (realtime, infra).
 */
@Module({ controllers: [SupportStreamsController] })
export class SupportInfraModule {}
