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
      [
        'Multi-tenant examination platform: organizations, teachers, students,',
        'quizzes with mixed Bangla/English + LaTeX content, timed attempts,',
        'leaderboards and dashboards.',
        '',
        'Auth: send `Authorization: Bearer <accessToken>`. Org-scoped routes',
        'need an organization selected via POST /auth/organizations/{id}/select.',
        'Device-locked accounts must also send the `X-Device-Id` header.',
      ].join('\n'),
    )
    .setVersion('2.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addGlobalParameters({
      name: 'X-Device-Id',
      in: 'header',
      required: false,
      description:
        'Stable client-generated device identifier (ADR-0017). Required for device-locked accounts.',
      schema: { type: 'string' },
    })
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
