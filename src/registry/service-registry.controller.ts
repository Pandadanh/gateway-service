import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ServiceRegistryService } from './service-registry.service';

@Controller('registry')
export class ServiceRegistryController {
  private readonly logger = new Logger(ServiceRegistryController.name);

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
    this.logger.log(`📥 Registration request received: ${body?.service} (${body?.instanceId})`);
    
    if (!body || !body.service || !body.baseUrl || !body.instanceId) {
      this.logger.error('Invalid registration request: missing required fields', body);
      throw new Error('Invalid request body: service, baseUrl, and instanceId are required');
    }

    const result = this.registry.register(body);
    this.logger.log(
      `✅ Service registered successfully: ${body.service} (${body.instanceId}) at ${body.baseUrl}`,
    );
    return result;
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
