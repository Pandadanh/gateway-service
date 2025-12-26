import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ProxyMiddleware } from './proxy.middleware';
import { RegistryModule } from '../registry/registry.module';

@Module({
  imports: [RegistryModule],
  providers: [ProxyMiddleware],
})
export class ProxyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ProxyMiddleware).forRoutes('*');
  }
}
