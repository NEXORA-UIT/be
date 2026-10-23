import http from 'node:http';
import { app } from './app.js';
import { appConfig } from './config/app.config.js';
import { redis } from './infrastructure/redis/client.js';
import { prisma } from './infrastructure/database/prisma.js';
import { initRealtimeWebSocket } from './infrastructure/websocket/websocket.server.js';

try {
  await prisma.$connect();
  await redis.connect();

  const server = http.createServer(app);
  initRealtimeWebSocket(server);

  server.listen(appConfig.port, () => {
    console.log(`Nexora API listening on port ${appConfig.port}`);
  });
} catch (error) {
  console.error('Cannot start Nexora API:', error);
  process.exit(1);
}
