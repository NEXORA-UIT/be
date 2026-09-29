import express from 'express';
import { apiRouter } from './routes/index.js';
import { swaggerRouter } from './docs/swagger.js';

export const app = express();

// Swagger UI Documentation
app.use('/api/docs', swaggerRouter);

// REST API v1 routes
app.use('/api/v1', apiRouter);

app.get('/', (_request, response) => {
  response.type('text/plain').send('Hello World!');
  console.log('DCM M');
});

