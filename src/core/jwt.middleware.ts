import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { GatewayConfig } from '../config/gateway.config';
import { RoutesConfigService } from '../config/routes.config.service';

/**
 * Extract service name from path
 */
function getServiceFromPath(path: string): string | null {
  const match = path.match(/^\/([^/]+)(\/.*)?$/);
  return match?.[1] ?? null;
}

@Injectable()
export class JwtMiddleware implements NestMiddleware {
  private readonly jwtSecret: string;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly routesConfigService: RoutesConfigService,
  ) {
    const config = this.configService.get<GatewayConfig>('gatewayConfig');
    this.jwtSecret = config?.jwt.secret || '';
    this.enabled = config?.jwt.enabled || false;
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Skip JWT check if disabled
    if (!this.enabled) {
      return next();
    }

    const fullPath = req.originalUrl || req.url;
    const method = req.method;
    const service = getServiceFromPath(fullPath);

    // Check if route is public (no JWT required)
    if (service && this.routesConfigService.isPublicRoute(service, method, fullPath)) {
      return next();
    }

    // Check global public routes (no service prefix)
    if (!service && this.routesConfigService.isPublicRoute('', method, fullPath)) {
      return next();
    }

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Missing or invalid authorization token',
        error: 'Unauthorized',
      });
    }

    const token = authHeader.substring(7);
     if (!this.jwtSecret || typeof this.jwtSecret !== 'string' || this.jwtSecret.trim() === '') {
    throw new UnauthorizedException({
      statusCode: 401,
      message:'Authentication service is misconfigured',
      error: 'Unauthorized',
    })
      
    }

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      
      // Attach user info to request
      (req as any).user = decoded;
      
      next();
    } catch (error) {

      let message = 'Invalid token';
      if (error.name === 'TokenExpiredError') {
      message = 'Token has expired';
      } else if (error.name === 'NotBeforeError') {
        message = 'Token not yet valid';
      } else if (error.message?.includes('secret') || error.message?.includes('key')) {
        message = 'Authentication configuration error';
        } else if (error.name === 'JsonWebTokenError') {
        message = error.message === 'jwt malformed' ? 'Malformed token' : 'Invalid token';
      }

      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid token',
        error: 'Unauthorized',
      });
    }
  }
}

