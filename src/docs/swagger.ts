import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

/**
 * Resolves the absolute path to `docs/api/openapi.yaml`.
 * Uses module-relative resolution so it does not rely on process.cwd().
 */
function resolveOpenApiPath(): string {
  // Module-relative resolution (works in both src/ and dist/ build output)
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateFromModule = path.resolve(currentDir, '../../docs/api/openapi.yaml');
  if (fs.existsSync(candidateFromModule)) {
    return candidateFromModule;
  }

  // Fallback to process.cwd()
  const candidateFromCwd = path.resolve(process.cwd(), 'docs/api/openapi.yaml');
  if (fs.existsSync(candidateFromCwd)) {
    return candidateFromCwd;
  }

  throw new Error(
    `[Swagger Initialization Error] Cannot locate OpenAPI specification 'docs/api/openapi.yaml'.\n` +
      `Attempted resolution paths:\n` +
      `  1. ${candidateFromModule}\n` +
      `  2. ${candidateFromCwd}\n` +
      `Please ensure that docs/api/openapi.yaml exists in the repository root.`,
  );
}

/**
 * Loads and parses docs/api/openapi.yaml.
 * Throws a descriptive error if the file is missing or YAML syntax is invalid.
 */
function loadOpenApiSpec(): { document: Record<string, unknown>; rawYaml: string } {
  const filePath = resolveOpenApiPath();
  try {
    const rawYaml = fs.readFileSync(filePath, 'utf-8');
    const document = YAML.parse(rawYaml);
    if (!document || typeof document !== 'object') {
      throw new Error('Parsed OpenAPI content is empty or not a valid object.');
    }
    return { document: document as Record<string, unknown>, rawYaml };
  } catch (error) {
    throw new Error(
      `[Swagger Initialization Error] Failed to read or parse OpenAPI specification at '${filePath}':\n` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const { document: openApiDocument, rawYaml: openApiRawYaml } = loadOpenApiSpec();

/**
 * Developer-friendly Swagger UI configuration.
 * - deepLinking: enables direct URL linking to tags and operations
 * - displayOperationId: displays operation IDs
 * - persistAuthorization: keeps Bearer token across reloads
 * - filter: enables search box
 * - Preserves original OpenAPI tags ordering
 */
export const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    deepLinking: true,
    displayOperationId: true,
    persistAuthorization: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    tryItOutEnabled: true,
  },
  customSiteTitle: 'Nexora API Documentation',
};

export const swaggerRouter = Router();

// Expose raw OpenAPI document in JSON and YAML formats for tooling and developers
swaggerRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

swaggerRouter.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').send(openApiRawYaml);
});

// Mount Swagger UI
swaggerRouter.use('/', swaggerUi.serve, swaggerUi.setup(openApiDocument, swaggerUiOptions));
