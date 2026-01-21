import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ConfigService } from '@nestjs/config';
import { ServiceRegistryService } from '../registry/service-registry.service';
import { ServicesConfigService } from '../config/services.config.service';
import { GatewayConfig } from '../config/gateway.config';
import { getStaticUpstreams } from './upstream';
import { CircuitBreakerManager, CircuitState } from '../core/circuit-breaker';

/**
 * Extract service name from path
 * Supports formats:
 * - /service-name/api/... -> service-name
 * - /service-name/... -> service-name
 */
function getServiceFromPath(path: string): string | null {
  // Remove leading slash and get first segment
  const match = path.match(/^\/([^/]+)(\/.*)?$/);
  return match?.[1] ?? null;
}

/**
 * Strip service prefix from URL
 * /service-name/api/users -> /api/users
 * /service-name/users -> /users
 */
function stripServicePrefix(originalUrl: string): string {
  const [pathname, qs] = originalUrl.split('?');
  const idx = pathname.indexOf('/', 1);
  const rest = idx === -1 ? '/' : pathname.slice(idx);
  return qs ? `${rest}?${qs}` : rest;
}

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProxyMiddleware.name);
  private staticUpstreams: Record<string, string>;
  private readonly proxyConfig: GatewayConfig['proxy'];
  private readonly invalidServiceUrl: string;
  private readonly proxy: ReturnType<typeof createProxyMiddleware>;
  private readonly serviceDiscoveryRetries: number = 2;
  private readonly serviceDiscoveryDelay: number = 500;
  private readonly circuitBreaker: CircuitBreakerManager;

  constructor(
    private readonly registry: ServiceRegistryService,
    private readonly servicesConfig: ServicesConfigService,
    private readonly configService: ConfigService,
  ) {
    this.staticUpstreams = getStaticUpstreams(servicesConfig);
    const gatewayConfig =
      this.configService.get<GatewayConfig>('gatewayConfig');
    this.proxyConfig = gatewayConfig?.proxy || {
      timeout: 30000,
      proxyTimeout: 30000,
      slowRequestThreshold: 5000,
      invalidServiceUrl: 'http://127.0.0.1:9',
    };
    this.invalidServiceUrl = this.proxyConfig.invalidServiceUrl;

    // Initialize Circuit Breaker
    this.circuitBreaker = new CircuitBreakerManager({
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000,
      failureWindow: 60000,
    });

    this.proxy = createProxyMiddleware({
      changeOrigin: true,
      xfwd: true,
      ws: false,
      timeout: this.proxyConfig.timeout,
      proxyTimeout: this.proxyConfig.proxyTimeout,
      followRedirects: true,
      autoRewrite: false,
      preserveHeaderKeyCase: true,
      secure: false,

      router: (req: Request) => {
        const fullUrl = req.originalUrl || req.url;
        const service = getServiceFromPath(fullUrl);
        if (!service) return this.invalidServiceUrl;

        // Check circuit breaker
        if (!this.circuitBreaker.canRequest(service)) {
          this.logger.warn(`Circuit OPEN for ${service} - rejecting`);
          return this.invalidServiceUrl;
        }

        // Priority 1: Service Registry
        const inst = this.registry.pickHealthy(service);
        if (inst) {
          return inst.baseUrl;
        }

        // Priority 2: Static fallback
        const staticUrl = this.servicesConfig.getStaticService(service);
        if (staticUrl) {
          this.logger.warn(
            `Service "${service}" not found in registry, using static fallback: ${staticUrl}`,
          );
          return staticUrl;
        }

        return this.invalidServiceUrl;
      },

      pathRewrite: (_path, req: Request) => {
        const fullUrl = req.originalUrl || req.url;
        return stripServicePrefix(fullUrl);
      },

      on: {
        error: (err, _req, res) => {
          const req = _req as Request;
          const requestId = req.headers['x-request-id'];
          const fullUrl = req.originalUrl || req.url;
          const service = getServiceFromPath(fullUrl);

          // Record failure in circuit breaker
          if (service) {
            this.circuitBreaker.onFailure(service);
          }

          if (
            (err as any).code === 'ECONNABORTED' ||
            (err as any).code === 'ECONNRESET'
          ) {
            this.logger.debug(`Client aborted request ${requestId}`);
            return;
          }

          this.logger.error(
            `Proxy error for request ${requestId}: ${err?.message || err}`,
            err?.stack,
          );

          if ((res as Response).headersSent) {
            return;
          }

          (res as Response).status(502).json({
            status: 'error',
            message: 'Bad Gateway',
            detail: String((err as any)?.message ?? err),
            requestId,
            timestamp: new Date().toISOString(),
          });
        },
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader('x-gateway', 'nestjs-gateway');
          proxyReq.setHeader(
            'x-forwarded-for',
            (req as Request).ip || req.socket?.remoteAddress || '',
          );

          const rid = req.headers['x-request-id'];
          if (rid) proxyReq.setHeader('x-request-id', String(rid));

          // Forward user info if authenticated (for backend trust)
          const user = (req as any).user;
          if (user) {
            proxyReq.setHeader('x-user-id', user.id || user.userId || user.sub || '');
            if (user.email) proxyReq.setHeader('x-user-email', user.email);
            if (user.roles) {
              const roles = Array.isArray(user.roles) ? user.roles.join(',') : user.roles;
              proxyReq.setHeader('x-user-roles', roles);
            }
          }

          req.on('aborted', () => {
            proxyReq.destroy();
          });
        },
        proxyRes: (proxyRes, req) => {
          const fullUrl = (req as Request).originalUrl || req.url;
          const service = getServiceFromPath(fullUrl || '');

          // Record result in circuit breaker
          if (service) {
            if (proxyRes.statusCode && proxyRes.statusCode < 500) {
              this.circuitBreaker.onSuccess(service);
            } else if (proxyRes.statusCode && proxyRes.statusCode >= 500) {
              this.circuitBreaker.onFailure(service);
            }
          }

          // Log slow requests
          const startTime = (req as any)._startTime;
          if (startTime) {
            const duration = Date.now() - startTime;
            if (duration > this.proxyConfig.slowRequestThreshold) {
              const requestId = (req as Request).headers['x-request-id'];
              this.logger.warn(
                `Slow request detected: ${req.method} ${req.url} took ${duration}ms (requestId: ${requestId})`,
              );
            }
          }
        },
      },
    });
  }

  /**
   * Get circuit breaker stats for monitoring
   */
  getCircuitStats() {
    return this.circuitBreaker.getAllStats();
  }

  /**
   * Reset circuit breaker for a specific service
   */
  resetCircuit(serviceName: string): boolean {
    return this.circuitBreaker.resetCircuit(serviceName);
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuits(): number {
    return this.circuitBreaker.resetAllCircuits();
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const fullUrl = req.originalUrl || req.url;
    (req as any)._startTime = Date.now();

    // Skip proxy for gateway internal routes
    if (
      (req.method === 'GET' && /^\/health(?:\/|\?|$)/.test(fullUrl)) ||
      fullUrl.startsWith('/registry') ||
      fullUrl.startsWith('/metrics') ||
      fullUrl.startsWith('/circuits')
    ) {
      return next();
    }

    const service = getServiceFromPath(fullUrl);
    if (!service) {
      res.status(404).json({
        status: 'error',
        message: 'Invalid route - service name not found in path',
        path: fullUrl,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Check circuit breaker first
    const circuit = this.circuitBreaker.getCircuit(service);
    if (circuit.getState() === CircuitState.OPEN) {
      const stats = circuit.getStats();
      res.status(503).json({
        status: 'error',
        message: 'Service temporarily unavailable',
        service,
        reason: 'Circuit breaker is open - too many failures',
        retryAfter: stats.nextAttemptTime 
          ? Math.ceil((stats.nextAttemptTime - Date.now()) / 1000) 
          : 30,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Try to discover service with retries
    const isServiceAvailable = await this.checkServiceAvailability(service);

    if (!isServiceAvailable) {
      const registeredServices = this.registry.list().map((i) => i.service);
      const staticServices = Object.keys(this.staticUpstreams);
      const availableServices = [
        ...new Set([...registeredServices, ...staticServices]),
      ];

      res.status(503).json({
        status: 'error',
        message: 'Service unavailable',
        service,
        hint: 'Service must be registered via /registry/register or configured as static fallback',
        availableServices:
          availableServices.length > 0 ? availableServices : 'none',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    return this.proxy(req, res, next);
  }

  /**
   * Check if a service is available with retry logic to handle startup race conditions
   */
  private async checkServiceAvailability(service: string): Promise<boolean> {
    // Quick check first
    const healthyInstance = this.registry.pickHealthy(service);
    const hasStatic = this.servicesConfig.hasStaticFallback(service);

    if (healthyInstance || hasStatic) {
      return true;
    }

    // If not found, retry with delays (handles services that are still registering)
    for (let attempt = 1; attempt <= this.serviceDiscoveryRetries; attempt++) {
      this.logger.debug(
        `Service "${service}" not found, retry ${attempt}/${this.serviceDiscoveryRetries}...`,
      );

      // Wait before retry
      await new Promise((resolve) =>
        setTimeout(resolve, this.serviceDiscoveryDelay * attempt),
      );

      const retryInstance = this.registry.pickHealthy(service);
      const retryStatic = this.servicesConfig.hasStaticFallback(service);

      if (retryInstance || retryStatic) {
        this.logger.log(`Service "${service}" discovered on retry ${attempt}`);
        return true;
      }
    }

    return false;
  }
}
