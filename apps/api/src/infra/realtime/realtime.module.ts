import { Global, Module } from '@nestjs/common';
import { PgNotificationHub } from './pg-notification-hub';
import { SseService } from './sse.service';

/**
 * ADR-0026 · Real-time: satu koneksi LISTEN per instans (`PgNotificationHub`) + helper aliran SSE (`SseService`).
 * Koneksi LISTEN baru dibuka saat aliran pertama berlangganan, jadi instans tanpa display tidak memegang koneksi ekstra.
 */
@Global()
@Module({ providers: [PgNotificationHub, SseService], exports: [PgNotificationHub, SseService] })
export class RealtimeModule {}
