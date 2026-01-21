import { Controller, Get, Post, Param, Body } from '@nestjs/common';
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

  @Post('reset')
  resetAllCircuits() {
    const count = this.proxyMiddleware.resetAllCircuits();
    return {
      success: true,
      message: `Reset ${count} circuit breaker(s)`,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('reset/:service')
  resetCircuit(@Param('service') service: string) {
    const success = this.proxyMiddleware.resetCircuit(service);
    return {
      success,
      message: success 
        ? `Circuit breaker for ${service} has been reset`
        : `Circuit breaker for ${service} not found`,
      timestamp: new Date().toISOString(),
    };
  }
}

