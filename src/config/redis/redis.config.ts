const port = process.env.REDIS_PORT ?? '6379';
export const redisConfig = {
  url: process.env.REDIS_URL ?? `redis://127.0.0.1:${port}`,
};
