import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let error: any = null;

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (typeof response === 'object' && response !== null) {
        error = response;
        message = (response as any).message || message;
      }
    } else if (exception?.message) {
      message = exception.message;
    }

    const errorResponse = {
      status: 'error',
      requestId: req.headers['x-request-id'] || 'unknown',
      path: req.originalUrl || req.url,
      method: req.method,
      statusCode: status,
      message,
      ...(error && typeof error === 'object' ? { error } : {}),
      timestamp: new Date().toISOString(),
    };

    // Log error for debugging
    if (status >= 500) {
      this.logger.error(
        `${errorResponse.method} ${errorResponse.path} - ${status} - ${errorResponse.message}`,
        exception?.stack,
      );
    } else if (status >= 400) {
      this.logger.warn(
        `${errorResponse.method} ${errorResponse.path} - ${status} - ${errorResponse.message}`,
      );
    }

    res.status(status).json(errorResponse);
  }
}
