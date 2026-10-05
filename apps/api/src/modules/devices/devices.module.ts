import { Module } from '@nestjs/common';
import {
  DeviceEnrolmentController,
  DeviceSelfController,
  DevicesAdminController,
} from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

/**
 * ADR-0027 · Prinsipal perangkat (anjungan F05, display TV F04): pendaftaran oleh admin per unit, penukaran kode
 * sekali pakai oleh perangkat, identitas perangkat, dan pencabutan. Penjaga `DeviceGuard` + `@DeviceScoped()` ada di
 * infra/common sehingga modul `kiosk` dan `queue` tinggal memakainya.
 */
@Module({
  controllers: [DevicesAdminController, DeviceEnrolmentController, DeviceSelfController],
  providers: [DevicesService, DevicesRepository],
})
export class DevicesModule {}
