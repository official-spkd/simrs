import { Global, Module } from '@nestjs/common';
import { API_ENV, loadApiEnv } from '../config/env';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => loadApiEnv() }, PrismaService, RedisService],
  exports: [API_ENV, PrismaService, RedisService],
})
export class InfraModule {}
