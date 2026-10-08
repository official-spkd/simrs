import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DocumentsModule } from '../documents/documents.module';
import { MicroController, PaController } from './micro-pa.controller';
import { MicroService } from './micro.service';
import { PaService } from './pa.service';

/**
 * S02 · Mikrobiologi + patologi anatomi (rencana fase 4 §4.8, ADR-0120): isolat + uji kepekaan per tahap, laporan
 * tahap ber-validasi dua tingkat + TTE, antibiogram; laporan PA berversi + TTE. Didaftarkan sekali di `AppModule`.
 */
@Module({
  imports: [AuthzModule, DocumentsModule],
  controllers: [MicroController, PaController],
  providers: [MicroService, PaService],
})
export class MicroPaModule {}
