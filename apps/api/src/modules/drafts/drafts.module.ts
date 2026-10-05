import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';

/** K · Draf klinis (bukan rekam medis, ADR-0028 butir 5); dibersihkan job worker `clinical.drafts-cleanup`. */
@Module({
  imports: [AuthzModule],
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}
