import express from 'express';
import { apiRouter } from './routes/index.js';
import { swaggerRouter } from './docs/swagger.js';
import { errorMiddleware } from './shared/middlewares/error.middleware.js';
import { realtimeMutationMiddleware } from './infrastructure/realtime/realtime-mutation.middleware.js';

export const app = express();
const parseJson = express.json({ limit: '32kb' });
app.use(parseJson);

// Swagger UI Documentation
app.use('/api/docs', swaggerRouter);

// REST API v1 routes
app.use('/api/v1', realtimeMutationMiddleware);
app.use('/api/v1', apiRouter);

app.get('/', (_request, response) => {
  response.type('text/plain').send('Hello World!');
});

app.use(errorMiddleware);
