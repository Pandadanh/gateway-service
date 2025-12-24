import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  // Nếu FE khác origin (localhost:3000) thì bật:
  app.enableCors({
    origin: true,
    credentials: true,
  });

  await app.listen(8081, '0.0.0.0');
}
bootstrap();
