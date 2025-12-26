import { Module } from '@nestjs/common';
import { RegistryModule } from './registry/registry.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  imports: [RegistryModule, ProxyModule],
})
export class AppModule {}
