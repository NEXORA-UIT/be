import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { AppError } from '../../src/shared/errors/app.error.js';
import { errorMiddleware } from '../../src/shared/middlewares/error.middleware.js';

test('central error middleware formats domain errors and malformed JSON', async () => {
  const app = express();
  const parseJson = express.json();
  app.use(parseJson);
  app.post('/body', (_request, response) => {
    response.json({ success: true });
  });
  app.get('/domain', () => {
    throw new AppError(409, 'CONFLICT', 'Already exists');
  });
  app.use(errorMiddleware);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const domainResponse = await fetch(`${base}/domain`);
    const domainBody = await domainResponse.json();
    assert.equal(domainResponse.status, 409);
    assert.deepEqual(domainBody, {
      success: false,
      error: { code: 'CONFLICT', message: 'Already exists', details: [] },
    });
    const malformedResponse = await fetch(`${base}/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    const malformedBody = await malformedResponse.json();
    assert.equal(malformedResponse.status, 400);
    assert.equal(malformedBody.error.code, 'VALIDATION_ERROR');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
