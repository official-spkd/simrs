import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { securityHeaders } from './common/security-headers';
import type { ApiEnv } from './config/env';

/** Batas ukuran body JSON. Unggahan berkas memakai jalur terpisah (MinIO, URL bertanda tangan) di P08. */
export const JSON_BODY_LIMIT = '1mb';

/** Konfigurasi bersama untuk main.ts dan tes, agar perilaku tes = perilaku runtime. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  // Paling awal: berlaku untuk semua rute termasuk Swagger dan 404.
  app.use(securityHeaders({ hsts: env.APP_ENV === 'production' }));
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
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
