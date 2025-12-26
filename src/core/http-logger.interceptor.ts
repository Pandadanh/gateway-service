import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs/operators';

@Injectable()
export class HttpLoggerInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        const rid = req.headers['x-request-id'];
        console.log(
          `[${rid}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`,
        );
      }),
    );
  }
}
