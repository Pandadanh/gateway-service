export type ServiceStatus = 'healthy' | 'unhealthy';

export interface ServiceInstance {
  service: string;
  baseUrl: string;
  instanceId: string;
  status: ServiceStatus;
  lastSeenAt: number;
  meta?: Record<string, any>;
}
