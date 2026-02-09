import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ProxyMiddleware } from './proxy.middleware';
import { WebSocketProxyService } from './websocket-proxy.service';
import { RegistryModule } from '../registry/registry.module';
import { JwtMiddleware } from '../core/jwt.middleware';
import { RateLimitMiddleware } from '../core/rate-limit.middleware';
import { RoutesConfigService } from '../config/routes.config.service';
import { ServicesConfigService } from '../config/services.config.service';
import { GatewayConfig } from '../config/gateway.config';
import { CircuitsController } from '../core/circuits.controller';
import { XUserSessionMiddleware } from 'src/core/signature.middleware';

@Module({
  imports: [
    RegistryModule, 
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CircuitsController],
  providers: [
    ProxyMiddleware,
    JwtMiddleware,
    XUserSessionMiddleware,
    RoutesConfigService,
    ServicesConfigService,
    WebSocketProxyService,
  ],
  exports: [ProxyMiddleware, WebSocketProxyService],
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
    const internalRoutes = [
      '/health',
      '/metrics',
      '/registry',
      '/circuits',
    ];
    const xUserSessionRoutes = [
      '/health',
      '/metrics',
      '/registry/*path',
      '/circuits',
    ];
    // Rate limiting (first) - skip internal routes
    consumer
      .apply(this.rateLimitMiddleware.use.bind(this.rateLimitMiddleware))
      .exclude(...internalRoutes)
      .forRoutes('*');

    // // X-User-Session - public APIs, skip internal routes
      consumer
        .apply(XUserSessionMiddleware)
        .exclude(...xUserSessionRoutes)
        .forRoutes('*'); 

    // JWT authentication (second) - only if enabled, skip internal routes
    if (config?.jwt.enabled) {
      consumer
        .apply(JwtMiddleware)
        // .exclude(...internalRoutes)
        .forRoutes('*');
    }

    // Proxy routing (last) - skip internal routes
    consumer
      .apply(ProxyMiddleware)
      .exclude(...internalRoutes)
      .forRoutes('*');
  }
}
