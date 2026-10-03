import { Module } from '@nestjs/common';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { OutboxRepository } from './outbox.repository';

@Module({
  controllers: [DevToolsController],
  providers: [DevToolsService, OutboxRepository],
})
export class DevToolsModule {}
