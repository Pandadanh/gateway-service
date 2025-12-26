import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServiceRegistryService } from './service-registry.service';
import { ServiceRegistryController } from './service-registry.controller';
import { RegistryHealthJob } from './registry-health.job';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ServiceRegistryService, RegistryHealthJob],
  controllers: [ServiceRegistryController],
  exports: [ServiceRegistryService],
})
export class RegistryModule {}
