import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './core/request-id.middleware';
import { AllExceptionsFilter } from './core/all-exceptions.filter';
import { HttpLoggerInterceptor } from './core/http-logger.interceptor';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, { 
    bodyParser: true,
  });
  const configService = app.get(ConfigService);
  const gatewayConfig = configService.get<import('./config/gateway.config').GatewayConfig>('gatewayConfig');

  const port = gatewayConfig?.port || 8080;
  const bindAddress = gatewayConfig?.bindAddress || '0.0.0.0';
  const corsOrigins = gatewayConfig?.cors.origins || '*';

  app.enableCors({
    origin: corsOrigins === '*' ? true : (typeof corsOrigins === 'string' ? corsOrigins.split(',') : corsOrigins),
    credentials: gatewayConfig?.cors.credentials ?? true,
  });

  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  
  // HttpLoggerInterceptor is now provided via AppModule with ConfigService injection
  try {
    const httpLoggerInterceptor = app.get(HttpLoggerInterceptor);
    app.useGlobalInterceptors(httpLoggerInterceptor);
  } catch {
    // Fallback if not provided via module
    app.useGlobalInterceptors(new HttpLoggerInterceptor());
  }

  await app.listen(port, bindAddress);
  logger.log(`🚀 Gateway Service is running on: http://${bindAddress}:${port}`);
}
bootstrap();
