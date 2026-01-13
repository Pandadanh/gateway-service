export interface GatewayConfig {
  port: number;
  bindAddress: string;
  cors: {
    origins: string | string[];
    credentials: boolean;
  };
  jwt: {
    enabled: boolean;
    secret: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    cleanupProbability: number; // Probability for cleanup (0-1)
  };
  proxy: {
    timeout: number; // Request timeout in ms
    proxyTimeout: number; // Proxy timeout in ms
    slowRequestThreshold: number; // Log requests slower than this (ms)
    invalidServiceUrl: string; // URL to return when service not found
  };
  registry: {
    healthCheckInterval: number;
    instanceTtl: number;
    healthCheckTimeout: number; // Health check request timeout (ms)
    healthCheckEndpoint: string; // Health check endpoint path
  };
  logging: {
    level: string; // debug, info, warn, error
    slowRequestThreshold: number; // Log requests slower than this (ms)
    logErrorThreshold: number; // Log errors with status >= this
  };
  // Static services are now handled by ServicesConfigService
  // Only use service registry for true microservice architecture
}

export const gatewayConfig = (): GatewayConfig => ({
  port: parseInt(process.env.GATEWAY_PORT || '8080', 10),
  bindAddress: process.env.GATEWAY_BIND_ADDRESS || '0.0.0.0',
  cors: {
    origins: process.env.CORS_ORIGINS || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
  jwt: {
    enabled: process.env.JWT_ENABLED === 'true',
    secret: process.env.JWT_SECRET || '',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    cleanupProbability: parseFloat(process.env.RATE_LIMIT_CLEANUP_PROBABILITY || '0.01'),
  },
  proxy: {
    timeout: parseInt(process.env.PROXY_TIMEOUT_MS || '30000', 10),
    proxyTimeout: parseInt(process.env.PROXY_TIMEOUT_MS || '30000', 10),
    slowRequestThreshold: parseInt(process.env.PROXY_SLOW_REQUEST_THRESHOLD_MS || '5000', 10),
    invalidServiceUrl: process.env.PROXY_INVALID_SERVICE_URL || 'http://127.0.0.1:9',
  },
  registry: {
    healthCheckInterval: parseInt(
      process.env.REGISTRY_HEALTH_CHECK_INTERVAL || '5000',
      10,
    ),
    instanceTtl: parseInt(process.env.REGISTRY_INSTANCE_TTL || '30000', 10),
    healthCheckTimeout: parseInt(process.env.REGISTRY_HEALTH_CHECK_TIMEOUT_MS || '3000', 10),
    healthCheckEndpoint: process.env.REGISTRY_HEALTH_CHECK_ENDPOINT || '/health',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    slowRequestThreshold: parseInt(process.env.LOG_SLOW_REQUEST_THRESHOLD_MS || '1000', 10),
    logErrorThreshold: parseInt(process.env.LOG_ERROR_THRESHOLD || '400', 10),
  },
});

