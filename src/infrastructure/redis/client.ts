import { createClient } from 'redis';
import { redisConfig } from '../../config/redis/redis.config.js';

export const redis = createClient({
  url: redisConfig.url,
  disableOfflineQueue: true,
});

redis.on('error', (error: Error) => {
  console.error('Redis connection error:', error.message);
});
