import { Controller, Get } from '@nestjs/common';
import { ProxyMiddleware } from '../proxy/proxy.middleware';

@Controller('circuits')
export class CircuitsController {
  constructor(
    private readonly proxyMiddleware: ProxyMiddleware,
  ) {}

  @Get()
  getCircuitStats() {
    return {
      timestamp: new Date().toISOString(),
      circuits: this.proxyMiddleware.getCircuitStats ? 
        this.proxyMiddleware.getCircuitStats() : 
        { message: 'Circuit breaker stats not available' },
    };
  }
}

