import { app } from './app.js';
import { appConfig } from './config/app.config.js';
import { redis } from './infrastructure/redis/client.js';
import { prisma } from './infrastructure/database/prisma.js';

async function start() {
  await prisma.$connect();
  await redis.connect();
  app.listen(appConfig.port, () => {
    console.log(`Nexora API listening on port ${appConfig.port}`);
  });
}

start().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error('Cannot start Nexora API:', message);
  if (redis.isOpen) redis.destroy();
  await prisma.$disconnect();
  process.exitCode = 1;
});
