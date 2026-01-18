import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { ServiceRegistryService } from './service-registry.service';
import { ServiceRegistryController } from './service-registry.controller';
import { RegistryHealthJob } from './registry-health.job';
import { RedisRegistryService } from './redis-registry.service';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule],
  providers: [
    ServiceRegistryService,
    RedisRegistryService,
    RegistryHealthJob,
  ],
  controllers: [ServiceRegistryController],
  exports: [ServiceRegistryService, RedisRegistryService],
})
export class RegistryModule {}
