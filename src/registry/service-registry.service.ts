import { Injectable } from '@nestjs/common';
import { ServiceInstance } from './registry.types';

@Injectable()
export class ServiceRegistryService {
  private instances = new Map<string, ServiceInstance>(); // key = `${service}:${instanceId}`
  private rrCursor = new Map<string, number>(); // round-robin per service

  register(input: {
    service: string;
    baseUrl: string;
    instanceId: string;
    meta?: any;
  }) {
    const key = this.keyOf(input.service, input.instanceId);
    const inst: ServiceInstance = {
      ...input,
      status: 'healthy',
      lastSeenAt: Date.now(),
    };
    this.instances.set(key, inst);
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
    const healthy = this.list(service).filter((x) => x.status === 'healthy');
    if (healthy.length === 0) return null;

    const idx = (this.rrCursor.get(service) ?? 0) % healthy.length;
    this.rrCursor.set(service, idx + 1);
    return healthy[idx];
  }

  private keyOf(service: string, instanceId: string) {
    return `${service}:${instanceId}`;
  }
}
