import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ServiceRegistryService } from './service-registry.service';
import { GatewayConfig } from '../config/gateway.config';

@Injectable()
export class RegistryHealthJob {
  private readonly logger = new Logger(RegistryHealthJob.name);
  private healthCheckInterval: number;
  private instanceTtl: number;
  private healthCheckTimeout: number;
  private healthCheckEndpoint: string;

  constructor(
    private readonly registry: ServiceRegistryService,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<GatewayConfig>('gatewayConfig');
    this.healthCheckInterval = config?.registry.healthCheckInterval || 5_000;
    this.instanceTtl = config?.registry.instanceTtl || 30_000;
    this.healthCheckTimeout = config?.registry.healthCheckTimeout || 3000;
    this.healthCheckEndpoint = config?.registry.healthCheckEndpoint || '/health';
    
    this.logger.log(`Health check job configured: interval=${this.healthCheckInterval}ms, TTL=${this.instanceTtl}ms`);
  }

  @Interval(5_000) // Run every 5 seconds for faster recovery
  async run() {
    const config = this.configService.get<GatewayConfig>('gatewayConfig');
    const ttl = config?.registry.instanceTtl || 30_000;
    
    // Cleanup stale instances
    const beforeCount = this.registry.list().length;
    this.registry.cleanup(ttl);
    const afterCount = this.registry.list().length;
    
    if (beforeCount > afterCount) {
      this.logger.debug(`Cleaned up ${beforeCount - afterCount} stale instances`);
    }

    const all = this.registry.list();
    if (all.length === 0) return; // No instances to check

    const results = await Promise.all(
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
            return { service: inst.service, instanceId: inst.instanceId, healthy: false, reason: `HTTP ${r.status}` };
          } else {
            // Mark as healthy if health check passes
            const wasUnhealthy = inst.status === 'unhealthy';
            this.registry.heartbeat(inst.service, inst.instanceId);
            
            if (wasUnhealthy) {
              this.logger.log(`✅ Service recovered: ${inst.service} (${inst.instanceId})`);
            }
            return { service: inst.service, instanceId: inst.instanceId, healthy: true };
          }
        } catch (error) {
          this.registry.markUnhealthy(inst.service, inst.instanceId);
          return { service: inst.service, instanceId: inst.instanceId, healthy: false, reason: error.message };
        }
      }),
    );
    
    // Log unhealthy services
    const unhealthy = results.filter(r => !r.healthy);
    if (unhealthy.length > 0) {
      this.logger.warn(
        `Unhealthy services detected: ${unhealthy.map(u => `${u.service}(${u.instanceId}): ${u.reason}`).join(', ')}`
      );
    }
  }
}
