import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SurgeryAccess } from './surgery-access';
import { SurgeryBoardService } from './surgery-board.service';
import { SurgeryStreamController } from './surgery-stream.controller';
import { SurgeryController } from './surgery.controller';
import { SurgeryService } from './surgery.service';

/**
 * S06 · Kamar operasi (rencana fase 4 §4.7): jadwal 4 kamar, daftar tilik WHO, peristiwa, hitung kasa, BHP depo OK,
 * laporan operasi ber-TTE. Pola entri berversi, TTE, dan event domain dari `infra/clinical` dan `infra/events` (global).
 */
@Module({
  imports: [AuthzModule, NotificationsModule],
  controllers: [SurgeryController, SurgeryStreamController],
  providers: [SurgeryService, SurgeryBoardService, SurgeryAccess],
})
export class SurgeryModule {}
