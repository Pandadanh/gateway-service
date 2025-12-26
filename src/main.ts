import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './core/request-id.middleware';
import { AllExceptionsFilter } from './core/all-exceptions.filter';
import { HttpLoggerInterceptor } from './core/http-logger.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.enableCors({ origin: true, credentials: true });

  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new HttpLoggerInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(requestIdMiddleware);

  await app.listen(8080, '0.0.0.0');
}
bootstrap();
