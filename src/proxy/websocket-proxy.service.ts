import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyServer } from 'http-proxy';
import { IncomingMessage, Server } from 'http';
import { Socket } from 'net';
import { ServiceRegistryService } from '../registry/service-registry.service';
import { ServicesConfigService } from '../config/services.config.service';
import { JwtService } from '@nestjs/jwt';

/**
 * WebSocket Proxy Service
 * Handles WebSocket upgrade requests and proxies them to the appropriate backend service
 */
@Injectable()
export class WebSocketProxyService implements OnModuleInit {
  private readonly logger = new Logger(WebSocketProxyService.name);
  private wsProxy: ReturnType<typeof createProxyServer>;
  private httpServer: Server | null = null;
  private jwtSecret: string;

  constructor(
    private readonly registry: ServiceRegistryService,
    private readonly servicesConfig: ServicesConfigService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'default-secret';
  }

  onModuleInit() {
    // Create WebSocket proxy
    this.wsProxy = createProxyServer({
      ws: true,
      changeOrigin: true,
      xfwd: true,
    });

    this.wsProxy.on('error', (err, req, res) => {
      this.logger.error(`WebSocket proxy error: ${err.message}`, err.stack);
      if (res && typeof res === 'object' && 'writeHead' in res) {
        (res as any).writeHead(502, { 'Content-Type': 'text/plain' });
        (res as any).end('WebSocket proxy error');
      }
    });

    this.wsProxy.on('proxyReqWs', (proxyReq, req) => {
      // Forward auth headers that were set during handleUpgrade
      const incomingReq = req as IncomingMessage;
      if (incomingReq.headers['x-user-id']) {
        proxyReq.setHeader('x-user-id', incomingReq.headers['x-user-id'] as string);
      }
      if (incomingReq.headers['x-user-email']) {
        proxyReq.setHeader('x-user-email', incomingReq.headers['x-user-email'] as string);
      }
      if (incomingReq.headers['x-user-roles']) {
        proxyReq.setHeader('x-user-roles', incomingReq.headers['x-user-roles'] as string);
      }
    });
  }

  /**
   * Attach WebSocket handler to HTTP server
   */
  attachToServer(server: Server) {
    this.httpServer = server;
    
    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      this.handleUpgrade(req, socket, head);
    });
  }

  /**
   * Handle WebSocket upgrade request
   */
  private async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    const url = req.url || '';
    
    // Extract service from path: /{service}/socket.io/...
    const match = url.match(/^\/([^/]+)(\/socket\.io.*)?$/);
    if (!match) {
      this.logger.warn(`Invalid WebSocket path: ${url}`);
      socket.destroy();
      return;
    }

    const serviceName = match[1];

    // Authenticate WebSocket connection (optional - via query param)
    const authResult = await this.authenticateWebSocket(req);
    if (authResult) {
      // Add user info to headers for backend
      req.headers['x-user-id'] = authResult.userId;
      req.headers['x-user-email'] = authResult.email || '';
      req.headers['x-user-roles'] = authResult.roles?.join(',') || '';
    }

    // Find target service
    const target = await this.resolveServiceTarget(serviceName);
    if (!target) {
      this.logger.warn(`Service not found for WebSocket: ${serviceName}`);
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Rewrite path to strip service prefix
    const idx = url.indexOf('/', 1);
    req.url = idx === -1 ? '/socket.io/' : url.slice(idx);

    // Proxy the WebSocket
    this.wsProxy.ws(req, socket, head, { target }, (err) => {
      if (err) {
        this.logger.error(`WebSocket proxy failed: ${err.message}`);
        socket.destroy();
      }
    });
  }

  /**
   * Authenticate WebSocket connection via query parameter token
   */
  private async authenticateWebSocket(req: IncomingMessage): Promise<{
    userId: string;
    email?: string;
    roles?: string[];
  } | null> {
    try {
      const rawUrl = req.url || '';
      
      // Parse token from query string (socket.io format: /media/socket.io/?token=xxx&EIO=4...)
      let token: string | null = null;
      
      try {
        const url = new URL(rawUrl, `http://${req.headers.host}`);
        token = url.searchParams.get('token');
      } catch {
        // Fallback: manual query string parsing
        const queryStart = rawUrl.indexOf('?');
        if (queryStart !== -1) {
          const queryString = rawUrl.substring(queryStart + 1);
          const params = new URLSearchParams(queryString);
          token = params.get('token');
        }
      }
      
      if (!token) return null;
      
      const payload = this.jwtService.verify(token, { secret: this.jwtSecret });
      
      return {
        userId: payload.sub || payload.id || payload.userId,
        email: payload.email,
        roles: payload.roles,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve target URL for a service
   */
  private async resolveServiceTarget(serviceName: string): Promise<string | null> {
    // Priority 1: Service Registry
    const instance = this.registry.pickHealthy(serviceName);
    if (instance) {
      return instance.baseUrl;
    }

    // Priority 2: Static fallback
    const staticUrl = this.servicesConfig.getStaticService(serviceName);
    if (staticUrl) {
      return staticUrl;
    }

    return null;
  }
}

