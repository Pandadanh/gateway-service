import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ServiceRegistryService } from './service-registry.service';

@Controller('registry')
export class ServiceRegistryController {
  constructor(private readonly registry: ServiceRegistryService) {}

  @Post('register')
  register(
    @Body()
    body: {
      service: string;
      baseUrl: string;
      instanceId: string;
      meta?: any;
    },
  ) {
    return this.registry.register(body);
  }

  @Post('heartbeat/:service/:instanceId')
  heartbeat(
    @Param('service') service: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.registry.heartbeat(service, instanceId);
  }

  @Delete(':service/:instanceId')
  deregister(
    @Param('service') service: string,
    @Param('instanceId') instanceId: string,
  ) {
    return { ok: this.registry.deregister(service, instanceId) };
  }

  @Get()
  list(@Query('service') service?: string) {
    return this.registry.list(service);
  }
}
