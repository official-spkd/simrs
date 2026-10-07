import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { CONSENT_SIGNATURE_MAX_BYTES, MAX_DOCUMENT_BYTES } from '@simrs/shared';
import { rawUpload } from './common/raw-upload.middleware';
import { securityHeaders } from './common/security-headers';
import type { ApiEnv } from './config/env';

/** Batas ukuran body JSON. Berkas dokumen diunggah sebagai body biner di rute unggahan (P08). */
export const JSON_BODY_LIMIT = '1mb';

/** Konfigurasi bersama untuk main.ts dan tes, agar perilaku tes = perilaku runtime. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  // Paling awal: berlaku untuk semua rute termasuk Swagger dan 404.
  app.use(securityHeaders({ hsts: env.APP_ENV === 'production' }));
  app.disable('x-powered-by');
  // IP klien dan host asli dari web BFF/reverse proxy tepercaya saja (audit, batas laju, RS dari subdomain).
  if (env.TRUST_PROXY !== undefined) app.set('trust proxy', env.TRUST_PROXY);
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Unggah dokumen pasien: body biner dibaca sebelum transaksi dibuka (lihat rawUpload).
  app.use('/api/v1/patients/:patientId/documents', rawUpload(MAX_DOCUMENT_BYTES));
  // K11 · Gambar tanda tangan persetujuan di tablet (PNG kecil, ADR-0020/0058).
  app.use('/api/v1/consents/drafts/:id/signature-image', rawUpload(CONSENT_SIGNATURE_MAX_BYTES));
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableCors({
    origin: env.WEB_BASE_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Tenant-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.enableShutdownHooks();

  if (env.devTools) {
    const config = new DocumentBuilder()
      .setTitle('SIM RS API')
      .setDescription(
        'API SIM RS multi-tenant (lokal, data fiktif). Galat: { code, message, details, requestId }.',
      )
      .setVersion('0.1.0')
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }
}
