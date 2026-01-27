import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

interface ServicesConfig {
  services: {
    [serviceName: string]: string;
  };
}

@Injectable()
export class ServicesConfigService implements OnModuleInit {
  private readonly logger = new Logger(ServicesConfigService.name);
  private staticServices: Map<string, string> = new Map();
  private enabled: boolean;

  onModuleInit() {
    this.loadServicesConfig();
  }

  private loadServicesConfig() {
    // Check if static services are enabled
    this.enabled = process.env.USE_STATIC_SERVICES === 'true';

    // Always load static services config for WebSocket fallback, even if USE_STATIC_SERVICES=false
    // HTTP proxy will respect the flag, but WebSocket needs reliable fallback
    try {
      const possiblePaths = [
        process.env.SERVICES_CONFIG_PATH,
        join(process.cwd(), 'src', 'config', 'services.config.yaml'),
        join(process.cwd(), 'dist', 'config', 'services.config.yaml'),
        join(process.cwd(), 'services.config.yaml'),
      ].filter(Boolean) as string[];

      let configLoaded = false;
      for (const configPath of possiblePaths) {
        try {
          if (existsSync(configPath)) {
            const fileContent = readFileSync(configPath, 'utf-8');
            const config = yaml.load(fileContent) as ServicesConfig;
            
            if (config?.services) {
              for (const [serviceName, baseUrl] of Object.entries(config.services)) {
                this.staticServices.set(serviceName, baseUrl);
              }
            }
            
            this.logger.log(`Loaded ${this.staticServices.size} static services from: ${configPath}`);
            configLoaded = true;
            break;
          }
        } catch (err) {
          continue;
        }
      }

      // Fallback: Load from environment variables
      if (!configLoaded) {
        this.loadFromEnv();
      }
    } catch (error) {
      this.logger.warn(`Failed to load services config, using env variables: ${error.message}`);
      this.loadFromEnv();
    }
  }

  private loadFromEnv() {
    // Load from environment variables as fallback
    // Format: SERVICE_<NAME>_URL=http://...
    const envPrefix = 'SERVICE_';
    const envSuffix = '_URL';

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(envPrefix) && key.endsWith(envSuffix)) {
        const serviceName = key
          .slice(envPrefix.length, -envSuffix.length)
          .toLowerCase()
          .replace(/_/g, '-');
        
        if (value) {
          this.staticServices.set(serviceName, value);
        }
      }
    }

    if (this.staticServices.size > 0) {
      this.logger.log(`Loaded ${this.staticServices.size} static services from environment variables`);
    }
  }

  /**
   * Get static service URL (fallback only)
   */
  getStaticService(serviceName: string): string | null {
    if (!this.enabled) {
      return null;
    }
    return this.staticServices.get(serviceName) || null;
  }

  /**
   * Get static service URL for WebSocket (always enabled, regardless of USE_STATIC_SERVICES flag)
   * WebSocket connections need reliable fallback to hard-coded URLs
   */
  getStaticServiceForWebSocket(serviceName: string): string | null {
    return this.staticServices.get(serviceName) || null;
  }

  /**
   * Check if static services are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get all static services
   */
  getAllStaticServices(): Record<string, string> {
    return Object.fromEntries(this.staticServices);
  }

  /**
   * Check if a service has static fallback
   */
  hasStaticFallback(serviceName: string): boolean {
    return this.enabled && this.staticServices.has(serviceName);
  }
}


