import { Injectable, Logger } from '@nestjs/common';
import { ServiceInstance } from './registry.types';

@Injectable()
export class ServiceRegistryService {
  private readonly logger = new Logger(ServiceRegistryService.name);
  private readonly instances = new Map<string, ServiceInstance>(); // key = `${service}:${instanceId}`
  private readonly rrCursor = new Map<string, number>(); // round-robin per service

  register(input: {
    service: string;
    baseUrl: string;
    instanceId: string;
    meta?: any;
  }) {
    if (!input || !input.service || !input.baseUrl || !input.instanceId) {
      throw new Error('Invalid registration data: service, baseUrl, and instanceId are required');
    }

    const key = this.keyOf(input.service, input.instanceId);
    const existing = this.instances.get(key);
    
    const inst: ServiceInstance = {
      ...input,
      status: 'healthy',
      lastSeenAt: Date.now(),
    };
    this.instances.set(key, inst);
    
    if (existing) {
      this.logger.log(`🔄 Service re-registered: ${input.service} (${input.instanceId})`);
    } else {
      this.logger.log(`✨ New service registered: ${input.service} (${input.instanceId}) at ${input.baseUrl}`);
    }
    
    return inst;
  }

  heartbeat(service: string, instanceId: string) {
    const key = this.keyOf(service, instanceId);
    const inst = this.instances.get(key);
    if (!inst) return null;
    inst.lastSeenAt = Date.now();
    inst.status = 'healthy';
    this.instances.set(key, inst);
    return inst;
  }

  deregister(service: string, instanceId: string) {
    return this.instances.delete(this.keyOf(service, instanceId));
  }

  list(service?: string) {
    const all = [...this.instances.values()];
    return service ? all.filter((x) => x.service === service) : all;
  }

  markUnhealthy(service: string, instanceId: string) {
    const key = this.keyOf(service, instanceId);
    const inst = this.instances.get(key);
    if (!inst) return;
    inst.status = 'unhealthy';
    this.instances.set(key, inst);
  }

  cleanup(ttlMs = 30_000) {
    const now = Date.now();
    for (const [key, inst] of this.instances.entries()) {
      if (now - inst.lastSeenAt > ttlMs) this.instances.delete(key);
    }
  }

  pickHealthy(service: string): ServiceInstance | null {
    const allInstances = this.list(service);
    const healthy = allInstances.filter((x) => x.status === 'healthy');
    
    if (healthy.length === 0) {
      this.logger.warn(
        `No healthy instances found for service "${service}". Total instances: ${allInstances.length}`,
      );
      if (allInstances.length > 0) {
        this.logger.warn(`Instance statuses:`, allInstances.map((i) => ({
          instanceId: i.instanceId,
          status: i.status,
          lastSeenAt: new Date(i.lastSeenAt).toISOString(),
        })));
      }
      return null;
    }

    // Round-robin load balancing
    const currentCursor = this.rrCursor.get(service) ?? 0;
    const idx = currentCursor % healthy.length;
    this.rrCursor.set(service, currentCursor + 1);
    
    return healthy[idx];
  }

  /**
   * Get statistics for a service
   */
  getStats(service?: string) {
    const instances = this.list(service);
    const stats = {
      total: instances.length,
      healthy: instances.filter((i) => i.status === 'healthy').length,
      unhealthy: instances.filter((i) => i.status === 'unhealthy').length,
    };
    return stats;
  }

  private keyOf(service: string, instanceId: string) {
    return `${service}:${instanceId}`;
  }
}
