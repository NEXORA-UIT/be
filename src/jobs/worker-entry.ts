import { prisma } from '../infrastructure/database/prisma.js';
import { redis } from '../infrastructure/redis/client.js';
import { startWorkers } from './workers.js';

try {
  await prisma.$connect();
  await redis.connect();
  const workers = await startWorkers();
  console.log('Nexora background workers started');

  async function shutdown() {
    await workers.close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
} catch (error) {
  console.error('Cannot start background workers:', error);
  await prisma.$disconnect();
  process.exit(1);
}
