import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { GatewayConfig } from '../config/gateway.config';

@Injectable()
export class HttpLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggerInterceptor.name);
  private readonly logLevel: string;
  private readonly slowRequestThreshold: number;
  private readonly logErrorThreshold: number;

  constructor(private readonly configService?: ConfigService) {
    if (configService) {
      const config = configService.get<GatewayConfig>('gatewayConfig');
      this.logLevel = config?.logging?.level || 'info';
      this.slowRequestThreshold = config?.logging?.slowRequestThreshold || 1000;
      this.logErrorThreshold = config?.logging?.logErrorThreshold || 400;
    } else {
      // Fallback
      this.logLevel = process.env.LOG_LEVEL || 'info';
      this.slowRequestThreshold = parseInt(process.env.LOG_SLOW_REQUEST_THRESHOLD_MS || '1000', 10);
      this.logErrorThreshold = parseInt(process.env.LOG_ERROR_THRESHOLD || '400', 10);
    }
  }

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const start = Date.now();
    const rid = req.headers['x-request-id'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = (req as any).user?.id || (req as any).user?.userId || null;

    // Skip logging for health checks if log level is not debug
    const isHealthCheck = req.path === '/health' || req.path.startsWith('/metrics');
    if (isHealthCheck && this.logLevel !== 'debug') {
      return next.handle();
    }

    // Log request (only if debug level)
    if (this.logLevel === 'debug') {
      this.logger.debug(
        `${req.method} ${req.originalUrl || req.url} - IP: ${ip}, UserId: ${userId || 'anonymous'}`,
      );
    }

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        const statusCode = res.statusCode;
        
        // Only log errors and slow requests in production
        if (this.logLevel === 'debug' || statusCode >= this.logErrorThreshold || ms > this.slowRequestThreshold) {
          const logMessage = `${req.method} ${req.originalUrl || req.url} - ${statusCode} - ${ms}ms (requestId: ${rid})`;
          
          if (statusCode >= 500) {
            this.logger.error(logMessage);
          } else if (statusCode >= 400) {
            this.logger.warn(logMessage);
          } else if (this.logLevel === 'debug') {
            this.logger.debug(logMessage);
          } else if (ms > this.slowRequestThreshold) {
            this.logger.warn(`Slow request: ${logMessage}`);
          }
        }
      }),
      catchError((error) => {
        const ms = Date.now() - start;
        const statusCode = error?.status || 500;
        const errorMessage = `${req.method} ${req.originalUrl || req.url} - ${statusCode} - ${ms}ms (requestId: ${rid})`;
        
        if (this.logLevel === 'debug') {
          this.logger.error(errorMessage, error?.stack);
        } else {
          this.logger.error(`${errorMessage} - ${error?.message || 'Unknown error'}`);
        }
        
        return throwError(() => error);
      }),
    );
  }
}
