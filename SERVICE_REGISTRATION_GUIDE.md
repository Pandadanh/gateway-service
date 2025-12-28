# Hướng dẫn đăng ký Service với Gateway

## Tổng quan

Gateway Service hoạt động như một API Gateway với Service Discovery tự động. Các microservices tự động đăng ký khi khởi động và gateway sẽ route requests đến chúng.

## Cách đăng ký Service mới

### Bước 1: Tạo Gateway Registry Service

Copy file `gateway-registry.service.ts` từ `badminton-booking-BE/src/common/services/` vào service mới của bạn.

Hoặc tạo mới với nội dung tương tự.

### Bước 2: Thêm vào Module

Trong module chính của service (ví dụ: `app.module.ts` hoặc `common.module.ts`):

```typescript
import { GatewayRegistryService } from './common/services/gateway-registry.service';

@Module({
  providers: [
    // ... other providers
    GatewayRegistryService,
  ],
  // ...
})
export class AppModule {}
```

### Bước 3: Cấu hình Environment Variables

Thêm vào file `.env` của service:

```env
# Gateway Registry Configuration
GATEWAY_REGISTRY_ENABLED=true
GATEWAY_URL=http://localhost:8080
SERVICE_NAME=your-service-name
SERVICE_BASE_URL=http://localhost:8082
SERVICE_INSTANCE_ID=your-service-1
GATEWAY_HEARTBEAT_INTERVAL=5000
```

**Giải thích:**
- `GATEWAY_REGISTRY_ENABLED`: Bật/tắt auto-registration (mặc định: `true`)
- `GATEWAY_URL`: URL của Gateway Service
- `SERVICE_NAME`: Tên service (sẽ route qua `/service-name/api/...`)
- `SERVICE_BASE_URL`: Base URL của service này
- `SERVICE_INSTANCE_ID`: ID duy nhất của instance (có thể để auto-generate)
- `GATEWAY_HEARTBEAT_INTERVAL`: Khoảng thời gian gửi heartbeat (ms)

### Bước 4: Đảm bảo có Health Endpoint

Service phải có endpoint `/health` hoặc `/api/health` để gateway health check:

```typescript
@Controller()
export class AppController {
  @Get('health')
  @Public() // Bypass authentication
  getHealth() {
    return { status: 'ok' };
  }
}
```

### Bước 5: Cấu hình Public Routes (nếu cần)

Thêm public routes vào `gateway-service/src/config/routes.config.yaml`:

```yaml
services:
  your-service-name:
    public:
      - method: GET
        path: /api/health
      - method: POST
        path: /api/auth/login
      # ... other public routes
```

## Ví dụ: Đăng ký Media Service

### 1. Cấu hình `.env`:

```env
GATEWAY_REGISTRY_ENABLED=true
GATEWAY_URL=http://localhost:8080
SERVICE_NAME=media
SERVICE_BASE_URL=http://localhost:8082
SERVICE_INSTANCE_ID=media-1
```

### 2. Routes sẽ là:

```
http://localhost:8080/media/api/upload
http://localhost:8080/media/api/files/123
```

Gateway sẽ tự động forward đến `http://localhost:8082/api/upload`, `http://localhost:8082/api/files/123`

## API Endpoints của Gateway

### 1. Đăng ký Service (Tự động)

Service tự động gọi khi start:
```
POST /registry/register
Body: {
  "service": "core",
  "baseUrl": "http://localhost:8081",
  "instanceId": "core-1",
  "meta": { ... }
}
```

### 2. Heartbeat (Tự động)

Service tự động gửi mỗi 5 giây:
```
POST /registry/heartbeat/:service/:instanceId
```

### 3. Hủy đăng ký (Tự động)

Service tự động gọi khi shutdown:
```
DELETE /registry/:service/:instanceId
```

### 4. Xem danh sách Services

```
GET /registry
GET /registry?service=core
```

### 5. Xem Metrics

```
GET /metrics
GET /metrics/health
GET /metrics/stats
GET /metrics/stats?service=core
```

## Kiểm tra Service đã đăng ký

### 1. Qua Gateway API:

```bash
# Xem tất cả services
GET http://localhost:8080/registry

# Xem service cụ thể
GET http://localhost:8080/registry?service=core

# Xem metrics
GET http://localhost:8080/metrics
```

### 2. Qua Logs:

Gateway logs:
```
✨ New service registered: core (core-1) at http://localhost:8081
✅ Service registered successfully: core (core-1) at http://localhost:8081
```

Service logs:
```
✅ Service registered successfully with gateway: core (core-1)
```

## Troubleshooting

### Service không đăng ký được

1. **Kiểm tra Gateway có đang chạy không:**
   ```bash
   GET http://localhost:8080/health
   ```

2. **Kiểm tra GATEWAY_URL có đúng không:**
   ```env
   GATEWAY_URL=http://localhost:8080
   ```

3. **Kiểm tra logs của service:**
   - Tìm `GatewayRegistryService` logs
   - Xem có lỗi network không

### Service bị đánh dấu unhealthy

1. **Kiểm tra health endpoint:**
   ```bash
   GET http://localhost:8081/api/health
   ```

2. **Đảm bảo endpoint có @Public() decorator:**
   ```typescript
   @Get('health')
   @Public()
   getHealth() { ... }
   ```

3. **Kiểm tra SERVICE_BASE_URL có đúng không**

### Request bị chặn bởi JWT

1. **Thêm route vào public routes:**
   - File: `gateway-service/src/config/routes.config.yaml`
   - Thêm route vào `services.your-service-name.public`

2. **Hoặc tắt JWT trong gateway:**
   ```env
   JWT_ENABLED=false
   ```

## Best Practices

1. **Service Naming:**
   - Dùng tên ngắn gọn, dễ nhớ
   - Ví dụ: `core`, `media`, `queue`, `booking`

2. **Instance ID:**
   - Format: `{service-name}-{number}` hoặc `{service-name}-{uuid}`
   - Ví dụ: `core-1`, `media-abc123`

3. **Health Check:**
   - Luôn có endpoint `/health` hoặc `/api/health`
   - Response nhanh (< 100ms)
   - Không phụ thuộc vào external services

4. **Public Routes:**
   - Chỉ thêm routes thực sự cần public
   - Auth endpoints, public APIs, health checks

5. **Multiple Instances:**
   - Có thể chạy nhiều instances cùng service name
   - Gateway sẽ tự động load balance (round-robin)

## Ví dụ hoàn chỉnh

Xem file `badminton-booking-BE/GATEWAY_REGISTRY.md` để xem ví dụ đầy đủ.

