import { app } from './app.js';
import { createServer } from 'node:http';
import { appConfig } from './config/app.config.js';
import { redis } from './infrastructure/redis/client.js';
import { prisma } from './infrastructure/database/prisma.js';
import { startWorkers } from './jobs/workers.js';
import { closeQueues } from './infrastructure/queue/queue.client.js';
import { attachSocketServer } from './infrastructure/realtime/socket.server.js';

try {
  await prisma.$connect();
  await redis.connect();
  const workers = appConfig.backgroundWorkersEnabled ? await startWorkers() : undefined;
  const httpServer = createServer(app);
  const realtime = await attachSocketServer(httpServer);

  httpServer.listen(appConfig.port, () => {
    console.log(`Nexora API listening on port ${appConfig.port}`);
    if (workers) console.log('BullMQ workers started');
    console.log('Socket.IO realtime started');
  });

  const shutdown = async () => {
    await realtime.close();
    await workers?.close();
    await closeQueues();
    await redis.quit();
    await prisma.$disconnect();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
} catch (error) {
  console.error('Cannot start Nexora API:', error);
  process.exit(1);
}
