import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { FormDefinitionsService } from './form-definitions.service';
import { FormResponsesService } from './form-responses.service';
import { FormDefinitionsController, FormResponsesController } from './forms.controller';
import { FormsRepository } from './forms.repository';

/** P07 · Form engine berversi: definisi (komite RM) dan isian pasien (append-only). */
@Module({
  imports: [AuthzModule],
  controllers: [FormDefinitionsController, FormResponsesController],
  providers: [FormDefinitionsService, FormResponsesService, FormsRepository],
  exports: [FormResponsesService],
})
export class FormsModule {}
