import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RegistryModule } from './registry/registry.module';
import { ProxyModule } from './proxy/proxy.module';
import { MetricsController } from './core/metrics.controller';
import { RoutesConfigService } from './config/routes.config.service';
import { ServicesConfigService } from './config/services.config.service';
import { HttpLoggerInterceptor } from './core/http-logger.interceptor';
import { gatewayConfig } from './config/gateway.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [gatewayConfig],
      envFilePath: '.env',
    }),
    RegistryModule,
    ProxyModule,
  ],
  controllers: [MetricsController],
  providers: [
    RoutesConfigService,
    ServicesConfigService,
    {
      provide: HttpLoggerInterceptor,
      useFactory: (configService: ConfigService) => {
        return new HttpLoggerInterceptor(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [RoutesConfigService, ServicesConfigService, HttpLoggerInterceptor],
})
export class AppModule {}
