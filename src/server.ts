import { app } from './app.js';
import { appConfig } from './config/app.config.js';
import { redis } from './infrastructure/redis/client.js';
import { prisma } from './infrastructure/database/prisma.js';

try {
  await prisma.$connect();
  await redis.connect();

  app.listen(appConfig.port, () => {
    console.log(`Nexora API listening on port ${appConfig.port}`);
  });
} catch (error) {
  console.error('Cannot start Nexora API:', error);
  process.exit(1);
}
