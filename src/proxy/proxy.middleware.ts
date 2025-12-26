import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ServiceRegistryService } from '../registry/service-registry.service';
import { STATIC_UPSTREAMS } from './upstream';

function getServiceFromPath(path: string) {
  const match = path.match(/^\/([^/]+)(\/.*)?$/);
  return match?.[1] ?? null;
}

function stripServicePrefix(originalUrl: string) {
  const [pathname, qs] = originalUrl.split('?');
  const idx = pathname.indexOf('/', 1);
  const rest = idx === -1 ? '/' : pathname.slice(idx);
  return qs ? `${rest}?${qs}` : rest;
}

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  constructor(private readonly registry: ServiceRegistryService) {}

  private proxy = createProxyMiddleware({
    changeOrigin: true,
    xfwd: true,
    ws: false,
    timeout: 5 * 60 * 1000,
    proxyTimeout: 5 * 60 * 1000,

    router: (req: Request) => {
      const fullUrl = req.originalUrl || req.url;
      const service = getServiceFromPath(fullUrl);
      if (!service) return 'http://127.0.0.1:9';

      // ưu tiên registry (nếu em có register/health/LB)
      const inst = this.registry.pickHealthy(service);
      if (inst) return inst.baseUrl;

      // fallback static
      return STATIC_UPSTREAMS[service] ?? 'http://127.0.0.1:9';
    },

    pathRewrite: (_path, req: Request) => {
      const fullUrl = req.originalUrl || req.url;
      return stripServicePrefix(fullUrl);
    },

    on: {
      error: (err, _req, res) => {
        (res as Response).status(502).json({
          status: 'error',
          message: 'Bad Gateway',
          detail: String((err as any)?.message ?? err),
        });
      },
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-gateway', 'nestjs');
        const rid = req.headers['x-request-id'];
        if (rid) proxyReq.setHeader('x-request-id', String(rid));
      },
    },
  });

  use(req: Request, res: Response, next: NextFunction) {
    const fullUrl = req.originalUrl || req.url;

    // gateway health
    if (req.method === 'GET' && /^\/health(?:\/|\?|$)/.test(fullUrl)) {
      res.status(200).send('ok');
      return;
    }

    const service = getServiceFromPath(fullUrl);
    if (!service) {
      res.status(404).send('Invalid route');
      return;
    }

    // chặn service lạ
    const hasRegistry = !!this.registry.pickHealthy(service);
    const hasStatic = !!STATIC_UPSTREAMS[service];
    if (!hasRegistry && !hasStatic) {
      res.status(404).send('Unknown service');
      return;
    }

    return this.proxy(req, res, next);
  }
}
