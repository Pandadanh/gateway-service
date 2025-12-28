import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProxyMiddleware } from './proxy.middleware';
import { RegistryModule } from '../registry/registry.module';
import { JwtMiddleware } from '../core/jwt.middleware';
import { RateLimitMiddleware } from '../core/rate-limit.middleware';
import { RoutesConfigService } from '../config/routes.config.service';
import { ServicesConfigService } from '../config/services.config.service';
import { GatewayConfig } from '../config/gateway.config';

@Module({
  imports: [RegistryModule, ConfigModule],
  providers: [
    ProxyMiddleware,
    JwtMiddleware,
    RoutesConfigService,
    ServicesConfigService,
  ],
  exports: [ProxyMiddleware],
})
export class ProxyModule implements NestModule {
  private rateLimitMiddleware: RateLimitMiddleware;

  constructor(
    private readonly configService: ConfigService,
    private readonly routesConfigService: RoutesConfigService,
  ) {
    // Rate limiting - use config service for full config
    this.rateLimitMiddleware = new RateLimitMiddleware(
      undefined,
      undefined,
      this.configService,
    );
  }

  configure(consumer: MiddlewareConsumer) {
    const config = this.configService.get<GatewayConfig>('gatewayConfig');

    // Internal routes that should bypass middleware
    // Using specific routes instead of wildcards to avoid path-to-regexp errors
    // Note: ProxyMiddleware already handles these internally via startsWith checks
    const internalRoutes = [
      '/health',
      '/metrics',
      '/registry',
    ];

    // Rate limiting (first) - skip internal routes
    consumer
      .apply(this.rateLimitMiddleware.use.bind(this.rateLimitMiddleware))
      .exclude(...internalRoutes)
      .forRoutes('*');

    // JWT authentication (second) - only if enabled, skip internal routes
    if (config?.jwt.enabled) {
      consumer
        .apply(JwtMiddleware)
        .exclude(...internalRoutes)
        .forRoutes('*');
    }

    // Proxy routing (last) - skip internal routes
    // Note: ProxyMiddleware already checks these routes internally via startsWith('/registry') and startsWith('/metrics')
    consumer
      .apply(ProxyMiddleware)
      .exclude(...internalRoutes)
      .forRoutes('*');
  }
}
