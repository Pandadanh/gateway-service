import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './core/request-id.middleware';
import { AllExceptionsFilter } from './core/all-exceptions.filter';
import { HttpLoggerInterceptor } from './core/http-logger.interceptor';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Disable global body parser - we'll apply it selectively
  // This prevents body parsing conflicts with http-proxy-middleware
  const app = await NestFactory.create(AppModule, { 
    bodyParser: false,
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
  
  // Apply body parsing only to gateway-specific routes (not proxied routes)
  app.use('/registry', json({ limit: '10mb' }), urlencoded({ extended: true, limit: '10mb' }));
  app.use('/metrics', json({ limit: '1mb' }), urlencoded({ extended: true, limit: '1mb' }));
  app.use('/health', json({ limit: '1mb' }), urlencoded({ extended: true, limit: '1mb' }));
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
