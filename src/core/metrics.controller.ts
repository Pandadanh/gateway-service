import { Controller, Get, Query } from '@nestjs/common';
import { ServiceRegistryService } from '../registry/service-registry.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly registry: ServiceRegistryService) {}

  @Get()
  getMetrics(@Query('service') service?: string) {
    const allInstances = service ? this.registry.list(service) : this.registry.list();
    const services = new Map<string, { healthy: number; unhealthy: number }>();

    allInstances.forEach((inst) => {
      const svc = inst.service;
      if (!services.has(svc)) {
        services.set(svc, { healthy: 0, unhealthy: 0 });
      }
      const stats = services.get(svc)!;
      if (inst.status === 'healthy') {
        stats.healthy++;
      } else {
        stats.unhealthy++;
      }
    });

    return {
      timestamp: new Date().toISOString(),
      totalInstances: allInstances.length,
      services: Object.fromEntries(services),
      instances: allInstances.map((inst) => ({
        service: inst.service,
        instanceId: inst.instanceId,
        status: inst.status,
        baseUrl: inst.baseUrl,
        lastSeenAt: new Date(inst.lastSeenAt).toISOString(),
        meta: inst.meta,
      })),
    };
  }

  @Get('health')
  getHealth() {
    const allInstances = this.registry.list();
    const healthyCount = allInstances.filter((i) => i.status === 'healthy').length;
    const totalCount = allInstances.length;

    return {
      status: totalCount > 0 && healthyCount > 0 ? 'healthy' : 'degraded',
      healthy: healthyCount,
      total: totalCount,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('stats')
  getStats(@Query('service') service?: string) {
    if (service) {
      return this.registry.getStats(service);
    }
    
    const allInstances = this.registry.list();
    const services = new Set(allInstances.map((i) => i.service));
    const stats: Record<string, any> = {};
    
    for (const svc of services) {
      stats[svc] = this.registry.getStats(svc);
    }
    
    return {
      timestamp: new Date().toISOString(),
      services: stats,
    };
  }
}

