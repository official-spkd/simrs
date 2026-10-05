import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { WorklistController } from './worklist.controller';
import { WorklistService } from './worklist.service';

/**
 * K01 · Worklist klinis (potongan 3.2b): pasien per tampilan (DPJP, unit, shift) dan tugas pribadi (co-sign, verifikasi,
 * tinjau order residen, TTE gagal, EWS tinggi, resume lewat batas, serah terima). Didaftarkan sekali di `AppModule`.
 */
@Module({
  imports: [AuthzModule],
  controllers: [WorklistController],
  providers: [WorklistService],
})
export class WorklistModule {}
