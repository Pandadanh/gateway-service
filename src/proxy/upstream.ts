import { ServicesConfigService } from '../config/services.config.service';

/**
 * Get static upstreams (fallback only)
 * In true microservice architecture, services should be discovered via service registry
 * Static services are only used as fallback when service is not registered
 */
export function getStaticUpstreams(servicesConfig: ServicesConfigService): Record<string, string> {
  return servicesConfig.getAllStaticServices();
}
