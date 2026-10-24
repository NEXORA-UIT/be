export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  backgroundWorkersEnabled: process.env.BACKGROUND_WORKERS_ENABLED !== 'false',
};
