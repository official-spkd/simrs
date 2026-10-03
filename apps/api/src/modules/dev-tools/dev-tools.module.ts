import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { OutboxRepository } from './outbox.repository';

@Module({
  imports: [TenancyModule],
  controllers: [DevToolsController],
  providers: [DevToolsService, OutboxRepository],
})
export class DevToolsModule {}
