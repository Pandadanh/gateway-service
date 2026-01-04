import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ConfigService } from '@nestjs/config';
import { ServiceRegistryService } from '../registry/service-registry.service';
import { ServicesConfigService } from '../config/services.config.service';
import { GatewayConfig } from '../config/gateway.config';
import { getStaticUpstreams } from './upstream';

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

  constructor(
    private readonly registry: ServiceRegistryService,
    private readonly servicesConfig: ServicesConfigService,
    private readonly configService: ConfigService,
  ) {
    this.staticUpstreams = getStaticUpstreams(servicesConfig);
    const gatewayConfig = this.configService.get<GatewayConfig>('gatewayConfig');
    this.proxyConfig = gatewayConfig?.proxy || {
      timeout: 30000,
      proxyTimeout: 30000,
      slowRequestThreshold: 5000,
      invalidServiceUrl: 'http://127.0.0.1:9',
    };
    this.invalidServiceUrl = this.proxyConfig.invalidServiceUrl;
    
    this.proxy = createProxyMiddleware({
    changeOrigin: true,
    xfwd: true,
    ws: false,
    timeout: this.proxyConfig.timeout,
    proxyTimeout: this.proxyConfig.proxyTimeout,
    followRedirects: true,
    autoRewrite: false,
    // Preserve request body for POST/PUT/PATCH requests
    preserveHeaderKeyCase: true,
    // Handle self-signed certificates
    secure: false,

    router: (req: Request) => {
      const fullUrl = req.originalUrl || req.url;
      const service = getServiceFromPath(fullUrl);
      if (!service) return this.invalidServiceUrl;

      // Priority 1: Service Registry (true microservice discovery)
      const inst = this.registry.pickHealthy(service);
      if (inst) {
        return inst.baseUrl;
      }

      // Priority 2: Static fallback (only if enabled and configured)
      const staticUrl = this.servicesConfig.getStaticService(service);
      if (staticUrl) {
        this.logger.warn(
          `Service "${service}" not found in registry, using static fallback: ${staticUrl}`,
        );
        return staticUrl;
      }

      // No service found
      return this.invalidServiceUrl;
    },

    pathRewrite: (_path, req: Request) => {
      const fullUrl = req.originalUrl || req.url;
      return stripServicePrefix(fullUrl);
    },

    on: {
      error: (err, _req, res) => {
        const requestId = (_req as Request).headers['x-request-id'];
        
        // Don't log/respond if client already disconnected
        if ((err as any).code === 'ECONNABORTED' || (err as any).code === 'ECONNRESET') {
          this.logger.debug(`Client aborted request ${requestId}`);
          return;
        }
        
        this.logger.error(
          `Proxy error for request ${requestId}: ${err?.message || err}`,
          err?.stack,
        );
        
        // Check if response already sent
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
        proxyReq.setHeader('x-forwarded-for', req.ip || req.connection.remoteAddress || '');
        
        const rid = req.headers['x-request-id'];
        if (rid) proxyReq.setHeader('x-request-id', String(rid));
        
        // Forward user info if authenticated
        const user = (req as any).user;
        if (user) {
          proxyReq.setHeader('x-user-id', user.id || user.userId || '');
        }
        
        // Handle client disconnect
        req.on('aborted', () => {
          proxyReq.destroy();
        });
      },
      proxyRes: (proxyRes, req) => {
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

  use(req: Request, res: Response, next: NextFunction) {
    const fullUrl = req.originalUrl || req.url;
    (req as any)._startTime = Date.now();

    // Skip proxy for gateway internal routes
    if (
      // Gateway health check
      (req.method === 'GET' && /^\/health(?:\/|\?|$)/.test(fullUrl)) ||
      // Registry endpoints (service registration)
      fullUrl.startsWith('/registry') ||
      // Metrics endpoints
      fullUrl.startsWith('/metrics')
    ) {
      // Let these routes pass through to be handled by controllers
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

    // Check if service is available (registry or static fallback)
    const healthyInstance = this.registry.pickHealthy(service);
    const hasRegistry = !!healthyInstance;
    const hasStatic = this.servicesConfig.hasStaticFallback(service);
    
    if (!hasRegistry && !hasStatic) {
      const registeredServices = this.registry.list().map((i) => i.service);
      const staticServices = Object.keys(this.staticUpstreams);
      const availableServices = [...new Set([...registeredServices, ...staticServices])];

      res.status(404).json({
        status: 'error',
        message: 'Service not found or not healthy',
        service,
        hint: 'Service must be registered via /registry/register or configured as static fallback',
        availableServices: availableServices.length > 0 ? availableServices : 'none',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    return this.proxy(req, res, next);
  }
}
