import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceInstance } from './registry.types';

/**
 * Redis-based Service Registry for production use
 * Falls back to in-memory if Redis is not available
 * 
 * Redis Key Structure:
 * - registry:services:{serviceName}:{instanceId} -> ServiceInstance JSON
 * - registry:services:{serviceName}:list -> Set of instanceIds
 */
@Injectable()
export class RedisRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisRegistryService.name);
  private redis: any | null = null;
  private readonly useRedis: boolean;
  private readonly redisUrl: string;
  
  // Fallback in-memory storage
  private readonly memoryInstances = new Map<string, ServiceInstance>();
  private readonly rrCursor = new Map<string, number>();
  
  // Cleanup interval
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(private readonly configService: ConfigService) {
    this.redisUrl = this.configService.get<string>('REDIS_URL') || '';
    this.useRedis = !!this.redisUrl;
  }

  async onModuleInit(): Promise<void> {
    if (this.useRedis) {
      try {
        // Dynamic import to avoid dependency issues
        const Redis = (await import('ioredis')).default;
        this.redis = new Redis(this.redisUrl, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          enableReadyCheck: true,
        });
        
        await this.redis.connect();
        this.logger.log('✅ Connected to Redis for service registry');
      } catch (error) {
        this.logger.warn('⚠️ Redis connection failed, using in-memory registry', error);
        this.redis = null;
      }
    } else {
      this.logger.log('Using in-memory service registry (REDIS_URL not configured)');
    }

    // Start cleanup job
    this.cleanupInterval = setInterval(() => {
      this.cleanup(30000).catch((err) => 
        this.logger.error('Cleanup error:', err)
      );
    }, 10000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private keyOf(service: string, instanceId: string): string {
    return `registry:services:${service}:${instanceId}`;
  }

  private listKeyOf(service: string): string {
    return `registry:services:${service}:list`;
  }

  async register(input: {
    service: string;
    baseUrl: string;
    instanceId: string;
    meta?: Record<string, unknown>;
  }): Promise<ServiceInstance> {
    const inst: ServiceInstance = {
      ...input,
      status: 'healthy',
      lastSeenAt: Date.now(),
    };

    if (this.redis) {
      const key = this.keyOf(input.service, input.instanceId);
      const listKey = this.listKeyOf(input.service);
      
      await this.redis.set(key, JSON.stringify(inst), 'EX', 60); // 60s TTL
      await this.redis.sadd(listKey, input.instanceId);
      await this.redis.expire(listKey, 300); // 5 min TTL for list
    } else {
      const key = this.keyOf(input.service, input.instanceId);
      this.memoryInstances.set(key, inst);
    }

    this.logger.log(`Registered: ${input.service} (${input.instanceId}) at ${input.baseUrl}`);
    return inst;
  }

  async heartbeat(service: string, instanceId: string): Promise<ServiceInstance | null> {
    const key = this.keyOf(service, instanceId);

    if (this.redis) {
      const data = await this.redis.get(key);
      if (!data) return null;

      const inst: ServiceInstance = JSON.parse(data);
      inst.lastSeenAt = Date.now();
      inst.status = 'healthy';
      
      await this.redis.set(key, JSON.stringify(inst), 'EX', 60);
      return inst;
    } else {
      const inst = this.memoryInstances.get(key);
      if (!inst) return null;

      inst.lastSeenAt = Date.now();
      inst.status = 'healthy';
      return inst;
    }
  }

  async deregister(service: string, instanceId: string): Promise<boolean> {
    const key = this.keyOf(service, instanceId);

    if (this.redis) {
      const listKey = this.listKeyOf(service);
      await this.redis.del(key);
      await this.redis.srem(listKey, instanceId);
      return true;
    } else {
      return this.memoryInstances.delete(key);
    }
  }

  async list(service?: string): Promise<ServiceInstance[]> {
    if (this.redis) {
      if (service) {
        const listKey = this.listKeyOf(service);
        const instanceIds = await this.redis.smembers(listKey);
        const instances: ServiceInstance[] = [];

        for (const instanceId of instanceIds) {
          const key = this.keyOf(service, instanceId);
          const data = await this.redis.get(key);
          if (data) {
            instances.push(JSON.parse(data));
          }
        }
        return instances;
      } else {
        // Get all services - scan for keys
        const keys = await this.redis.keys('registry:services:*:*');
        const instances: ServiceInstance[] = [];

        for (const key of keys) {
          if (!key.endsWith(':list')) {
            const data = await this.redis.get(key);
            if (data) {
              instances.push(JSON.parse(data));
            }
          }
        }
        return instances;
      }
    } else {
      const all = [...this.memoryInstances.values()];
      return service ? all.filter((x) => x.service === service) : all;
    }
  }

  async markUnhealthy(service: string, instanceId: string): Promise<void> {
    const key = this.keyOf(service, instanceId);

    if (this.redis) {
      const data = await this.redis.get(key);
      if (data) {
        const inst: ServiceInstance = JSON.parse(data);
        inst.status = 'unhealthy';
        await this.redis.set(key, JSON.stringify(inst), 'EX', 60);
      }
    } else {
      const inst = this.memoryInstances.get(key);
      if (inst) {
        inst.status = 'unhealthy';
      }
    }
  }

  async cleanup(ttlMs = 30000): Promise<void> {
    const now = Date.now();

    if (this.redis) {
      // Redis handles TTL automatically, but we clean up list references
      const services = new Set<string>();
      const keys = await this.redis.keys('registry:services:*:*');
      
      for (const key of keys) {
        if (!key.endsWith(':list')) {
          const parts = key.split(':');
          if (parts.length >= 4) {
            services.add(parts[2]);
          }
        }
      }

      for (const service of services) {
        const listKey = this.listKeyOf(service);
        const instanceIds = await this.redis.smembers(listKey);
        
        for (const instanceId of instanceIds) {
          const key = this.keyOf(service, instanceId);
          const exists = await this.redis.exists(key);
          if (!exists) {
            await this.redis.srem(listKey, instanceId);
          }
        }
      }
    } else {
      for (const [key, inst] of this.memoryInstances.entries()) {
        if (now - inst.lastSeenAt > ttlMs) {
          this.memoryInstances.delete(key);
          this.logger.log(`Removed stale instance: ${inst.service} (${inst.instanceId})`);
        }
      }
    }
  }

  async pickHealthy(service: string): Promise<ServiceInstance | null> {
    const instances = await this.list(service);
    const healthy = instances.filter((x) => x.status === 'healthy');

    if (healthy.length === 0) {
      this.logger.warn(`No healthy instances for ${service}`);
      return null;
    }

    // Round-robin
    const cursor = this.rrCursor.get(service) ?? 0;
    const idx = cursor % healthy.length;
    this.rrCursor.set(service, cursor + 1);

    return healthy[idx];
  }

  async getStats(service?: string): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
  }> {
    const instances = await this.list(service);
    return {
      total: instances.length,
      healthy: instances.filter((i) => i.status === 'healthy').length,
      unhealthy: instances.filter((i) => i.status === 'unhealthy').length,
    };
  }

  isUsingRedis(): boolean {
    return this.redis !== null;
  }
}

