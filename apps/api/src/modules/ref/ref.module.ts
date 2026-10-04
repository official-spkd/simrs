import { Module } from '@nestjs/common';
import { RefController } from './ref.controller';
import { RefService } from './ref.service';

/** P06 · Master data dan terminologi. Diekspor untuk validasi kode di modul klinis dan formulir (P07). */
@Module({
  controllers: [RefController],
  providers: [RefService],
  exports: [RefService],
})
export class RefModule {}
