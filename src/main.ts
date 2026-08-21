/* eslint-disable @typescript-eslint/no-floating-promises */
import type { Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvConfig } from './common/config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.getHttpAdapter().get('/', (_req: Request, res: Response) => {
    res.send('Quorlyn server is running');
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Quorlyn API')
    .setDescription(
      'Multi-tenant SaaS auth API — superadmin, organizations, teachers, students',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const configService = app.get(ConfigService<EnvConfig, true>);
  const port = configService.get('PORT', { infer: true });

  await app.listen(port);
  console.log(`Server is running on port ${port}`);
  console.log(`Swagger docs available at /docs`);
}
bootstrap();
