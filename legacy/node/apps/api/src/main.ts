import { config as loadEnv } from 'dotenv';
import * as path from 'path';

// `npm run dev:api` runs with cwd=apps/api (npm workspace scripts cd into
// the workspace dir), so a bare `import 'dotenv/config'` looks for
// apps/api/.env — which doesn't exist — and silently loads nothing,
// leaving every BOT_*/WHISPER_*/LISTENER_* var unset regardless of what's
// in the real .env at the repo root. Resolve explicitly relative to this
// compiled file's location (dist/main.js -> apps/api/dist -> repo root is
// 3 levels up) so it works the same regardless of invocation cwd.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter());
  const port = process.env.PORT ?? 4343;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`sidecar-meet API listening on http://localhost:${port}`);
}

bootstrap();
