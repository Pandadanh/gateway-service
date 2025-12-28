import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ServiceRegistryService } from './service-registry.service';
import { GatewayConfig } from '../config/gateway.config';

@Injectable()
export class RegistryHealthJob {
  private healthCheckInterval: number;
  private instanceTtl: number;
  private healthCheckTimeout: number;
  private healthCheckEndpoint: string;

  constructor(
    private readonly registry: ServiceRegistryService,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<GatewayConfig>('gatewayConfig');
    this.healthCheckInterval = config?.registry.healthCheckInterval || 10_000;
    this.instanceTtl = config?.registry.instanceTtl || 30_000;
    this.healthCheckTimeout = config?.registry.healthCheckTimeout || 5000;
    this.healthCheckEndpoint = config?.registry.healthCheckEndpoint || '/health';
  }

  @Interval(10_000) // Will be overridden by config
  async run() {
    const config = this.configService.get<GatewayConfig>('gatewayConfig');
    const ttl = config?.registry.instanceTtl || 30_000;
    this.registry.cleanup(ttl);

    const all = this.registry.list();
    await Promise.all(
      all.map(async (inst) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.healthCheckTimeout);
          
          const healthUrl = `${inst.baseUrl}${this.healthCheckEndpoint}`;
          const r = await fetch(healthUrl, {
            method: 'GET',
            signal: controller.signal,
          });
          
          clearTimeout(timeout);
          
          if (!r.ok) {
            this.registry.markUnhealthy(inst.service, inst.instanceId);
          } else {
            // Mark as healthy if health check passes
            this.registry.heartbeat(inst.service, inst.instanceId);
          }
        } catch {
          this.registry.markUnhealthy(inst.service, inst.instanceId);
        }
      }),
    );
  }
}
