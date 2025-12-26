import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ServiceRegistryService } from './service-registry.service';

@Injectable()
export class RegistryHealthJob {
  constructor(private readonly registry: ServiceRegistryService) {}

  @Interval(10_000)
  async run() {
    this.registry.cleanup(30_000);

    const all = this.registry.list();
    await Promise.all(
      all.map(async (inst) => {
        try {
          const r = await fetch(`${inst.baseUrl}/health`, { method: 'GET' });
          if (!r.ok) this.registry.markUnhealthy(inst.service, inst.instanceId);
        } catch {
          this.registry.markUnhealthy(inst.service, inst.instanceId);
        }
      }),
    );
  }
}
