import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { loadOpenApiDocument } from './openapi-loader.js';

const { document, rawYaml } = loadOpenApiDocument();

export const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    deepLinking: true,
    displayOperationId: true,
    persistAuthorization: true,
    filter: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  },
};

export const swaggerRouter = Router();

swaggerRouter.get('/openapi.json', (_request, response) => {
  response.json(document);
});

swaggerRouter.get('/openapi.yaml', (_request, response) => {
  response.type('text/yaml').send(rawYaml);
});

swaggerRouter.use('/', swaggerUi.serve, swaggerUi.setup(document, swaggerUiOptions));
