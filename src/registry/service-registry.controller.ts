import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
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
  async register(
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

    const result = await this.registry.register(body);
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
    const result = this.registry.heartbeat(service, instanceId);
    
    // Return 404 if service not found - signals to client to re-register
    if (!result) {
      this.logger.warn(`⚠️ Heartbeat for unknown service: ${service}/${instanceId} - returning 404`);
      throw new NotFoundException(`Service ${service}/${instanceId} not found. Please re-register.`);
    }
    
    return result;
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
