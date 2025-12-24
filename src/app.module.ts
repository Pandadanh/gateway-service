import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DynamicProxyMiddleware } from './proxy.middleware';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DynamicProxyMiddleware).forRoutes('*');
  }
}
