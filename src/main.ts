/* eslint-disable @typescript-eslint/no-floating-promises */
import type { Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().get('/', (_req: Request, res: Response) => {
    res.send('Quorlyn server is running');
  });
  await app.listen(process.env.PORT ?? 5000);
  console.log(`Server is running on port ${process.env.PORT ?? 5000}`);
}
bootstrap();
