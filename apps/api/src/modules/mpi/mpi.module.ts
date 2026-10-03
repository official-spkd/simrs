import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { MpiController } from './mpi.controller';
import { MpiRepository } from './mpi.repository';
import { MpiService } from './mpi.service';

/** P05 · Master Patient Index. Diekspor agar registrasi (F03) dan modul klinis bisa memakai identitas pasien. */
@Module({
  imports: [AuthzModule],
  controllers: [MpiController],
  providers: [MpiService, MpiRepository],
  exports: [MpiService],
})
export class MpiModule {}
