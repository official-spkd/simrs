import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { ConsentService } from './consent.service';
import { DuplicateDetector } from './duplicate-detector';
import { MpiMatchController } from './mpi-match.controller';
import { MpiMatchRepository } from './mpi-match.repository';
import { MpiMatchService } from './mpi-match.service';
import { MpiController } from './mpi.controller';
import { MpiRepository } from './mpi.repository';
import { MpiService } from './mpi.service';

/**
 * P05 · Master Patient Index: identitas pasien + tinjauan rekam medis ganda. Diekspor agar registrasi (F03) dan
 * modul klinis bisa memakai identitas pasien.
 */
@Module({
  imports: [AuthzModule],
  controllers: [MpiController, MpiMatchController],
  providers: [
    MpiService,
    MpiRepository,
    MpiMatchService,
    MpiMatchRepository,
    DuplicateDetector,
    ConsentService,
  ],
  exports: [MpiService],
})
export class MpiModule {}
