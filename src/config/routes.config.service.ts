import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

export interface RouteConfig {
  method: string;
  path: string;
}

export interface ServiceRouteConfig {
  public: RouteConfig[];
  private?: RouteConfig[];
}

export interface RoutesConfig {
  services: {
    [serviceName: string]: ServiceRouteConfig;
  };
  global: {
    public: RouteConfig[];
  };
}

@Injectable()
export class RoutesConfigService implements OnModuleInit {
  private readonly logger = new Logger(RoutesConfigService.name);
  private routesConfig: RoutesConfig;
  private publicRoutesCache = new Map<string, Set<string>>(); // service -> Set<method:path>

  onModuleInit() {
    this.loadRoutesConfig();
    this.buildCache();
  }

  private loadRoutesConfig() {
    try {
      // Try to load from config file
      // Support both development (src/config) and production (dist/config) paths
      const possiblePaths = [
        process.env.ROUTES_CONFIG_PATH,
        join(process.cwd(), 'src', 'config', 'routes.config.yaml'),
        join(process.cwd(), 'dist', 'config', 'routes.config.yaml'),
        join(process.cwd(), 'routes.config.yaml'),
      ].filter(Boolean) as string[];

      let configLoaded = false;
      for (const configPath of possiblePaths) {
        try {
          if (existsSync(configPath)) {
            const fileContent = readFileSync(configPath, 'utf-8');
            this.routesConfig = yaml.load(fileContent) as RoutesConfig;
            this.logger.log(`Loaded routes config from: ${configPath}`);
            configLoaded = true;
            break;
          }
        } catch (err) {
          // Try next path
          continue;
        }
      }

      if (!configLoaded) {
        throw new Error('Routes config file not found in any expected location');
      }
    } catch (error) {
      this.logger.warn(`Failed to load routes config file, using defaults: ${error.message}`);
      // Default config
      this.routesConfig = {
        services: {},
        global: {
          public: [
            { method: 'GET', path: '/health' },
            { method: 'GET', path: '/metrics' },
            { method: 'GET', path: '/metrics/*' },
            { method: 'GET', path: '/registry' },
            { method: 'POST', path: '/registry/register' },
            { method: 'POST', path: '/registry/heartbeat/*' },
          ],
        },
      };
    }
  }

  private buildCache() {
    // Build cache for fast lookup
    if (this.routesConfig.services) {
      for (const [serviceName, config] of Object.entries(this.routesConfig.services)) {
        const publicSet = new Set<string>();
        if (config.public) {
          for (const route of config.public) {
            const key = `${route.method.toUpperCase()}:${route.path}`;
            publicSet.add(key);
          }
        }
        this.publicRoutesCache.set(serviceName, publicSet);
      }
    }
  }

  /**
   * Check if a route is public (no JWT required)
   */
  isPublicRoute(serviceName: string, method: string, path: string): boolean {
    // Check global public routes
    if (this.routesConfig.global?.public) {
      for (const route of this.routesConfig.global.public) {
        if (this.matchRoute(route, method, path)) {
          return true;
        }
      }
    }

    // Check service-specific public routes
    const publicRoutes = this.publicRoutesCache.get(serviceName);
    if (publicRoutes) {
      const routeKey = `${method.toUpperCase()}:${path}`;
      
      // Exact match
      if (publicRoutes.has(routeKey)) {
        return true;
      }

      // Wildcard match (e.g., /api/public/*)
      for (const cachedRoute of publicRoutes) {
        const [, cachedPath] = cachedRoute.split(':');
        if (this.matchPathPattern(cachedPath, path)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Match route with wildcard support
   */
  private matchRoute(route: RouteConfig, method: string, path: string): boolean {
    if (route.method.toUpperCase() !== method.toUpperCase()) {
      return false;
    }
    return this.matchPathPattern(route.path, path);
  }

  /**
   * Match path pattern with wildcard support
   * Supports: /api/public/*, /api/public/images/*
   */
  private matchPathPattern(pattern: string, path: string): boolean {
    // Exact match
    if (pattern === path) {
      return true;
    }

    // Wildcard match
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\*\*/g, '.*') // ** matches any path
        .replace(/\*/g, '[^/]*'); // * matches any segment
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path);
    }

    return false;
  }

  /**
   * Get all public routes for a service
   */
  getPublicRoutes(serviceName: string): RouteConfig[] {
    return this.routesConfig.services[serviceName]?.public || [];
  }

  /**
   * Get full routes config
   */
  getRoutesConfig(): RoutesConfig {
    return this.routesConfig;
  }
}

