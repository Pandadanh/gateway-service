import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    const resp =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: exception?.message ?? 'Internal server error' };

    res.status(status).json({
      requestId: req.headers['x-request-id'],
      path: req.originalUrl,
      statusCode: status,
      error: resp,
      timestamp: new Date().toISOString(),
    });
  }
}
