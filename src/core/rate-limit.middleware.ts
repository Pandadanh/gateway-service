import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { GatewayConfig } from '../config/gateway.config';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly store = new Map<string, RateLimitStore>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly cleanupProbability: number;

  constructor(
    windowMs?: number,
    maxRequests?: number,
    private readonly configService?: ConfigService,
  ) {
    if (configService) {
      const config = configService.get<GatewayConfig>('gatewayConfig');
      this.windowMs = config?.rateLimit?.windowMs || 60000;
      this.maxRequests = config?.rateLimit?.maxRequests || 100;
      this.cleanupProbability = config?.rateLimit?.cleanupProbability || 0.01;
    } else {
      // Fallback for direct instantiation
      this.windowMs = windowMs || 60000;
      this.maxRequests = maxRequests || 100;
      this.cleanupProbability = 0.01;
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Skip rate limiting for health check
    if (req.path === '/health') {
      return next();
    }

    const key = this.getKey(req);
    const now = Date.now();
    const record = this.store.get(key);

    // Clean up old records periodically
    if (Math.random() < this.cleanupProbability) {
      this.cleanup(now);
    }

    if (!record || now > record.resetTime) {
      // New window
      this.store.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      this.setRateLimitHeaders(res, this.maxRequests, 1, this.windowMs);
      return next();
    }

    if (record.count >= this.maxRequests) {
      this.setRateLimitHeaders(res, this.maxRequests, record.count, record.resetTime - now);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later',
          retryAfter: Math.ceil((record.resetTime - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.count++;
    this.setRateLimitHeaders(res, this.maxRequests, record.count, record.resetTime - now);
    next();
  }

  private getKey(req: Request): string {
    // Prefer user ID if authenticated, otherwise use IP address
    const userId = (req as any).user?.id || (req as any).user?.userId;
    if (userId) {
      return `rate-limit:user:${userId}`;
    }
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `rate-limit:ip:${ip}`;
  }

  private setRateLimitHeaders(
    res: Response,
    limit: number,
    remaining: number,
    resetMs: number,
  ) {
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - remaining));
    res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + resetMs / 1000));
  }

  private cleanup(now: number) {
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

