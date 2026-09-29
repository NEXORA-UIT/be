import express from 'express';
import { apiRouter } from './routes/index.js';

export const app = express();

app.use('/api/v1', apiRouter);

app.get('/', (_request, response) => {
  response.type('text/plain').send('Hello World!');
  console.log('DCM M');
});
