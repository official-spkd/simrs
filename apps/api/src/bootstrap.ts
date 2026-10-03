import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

/** Konfigurasi bersama untuk main.ts dan tes, agar perilaku tes = perilaku runtime. */
export function configureApp(app: INestApplication, opts: { webOrigin: string; docs: boolean }): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableCors({ origin: opts.webOrigin, credentials: true });
  app.enableShutdownHooks();

  if (opts.docs) {
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
