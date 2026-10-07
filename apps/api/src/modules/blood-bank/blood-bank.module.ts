import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { BloodBankController } from './blood-bank.controller';
import { BloodBankService } from './blood-bank.service';
import { TransfusionService } from './transfusion.service';

/** S08 · Bank darah + transfusi di samping pasien (potongan 4.9, ADR-0105). Didaftarkan sekali di `AppModule`. */
@Module({
  imports: [AuthzModule],
  controllers: [BloodBankController],
  providers: [BloodBankService, TransfusionService],
})
export class BloodBankModule {}
