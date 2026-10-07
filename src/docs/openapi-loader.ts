import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

type YamlObject = Record<string, unknown>;
type OpenApiDocument = YamlObject & {
  paths: YamlObject;
  components: YamlObject;
};

const moduleNames = [
  'auth',
  'workspaces',
  'boards',
  'cards',
  'card-resources',
  'planning',
  'collaboration',
  'notifications',
  'quick-notes',
  'knowledge-base',
  'ai',
  'github',
  'system-administration',
] as const;

const componentNames = ['common', ...moduleNames] as const;

function asYamlObject(value: unknown, description: string): YamlObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${description} to be a YAML object.`);
  }
  return value as YamlObject;
}

function resolveOpenApiDirectory(): string {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDirectory, '../../docs/api/openapi'),
    path.resolve(process.cwd(), 'docs/api/openapi'),
  ];
  const directory = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'meta.yaml')),
  );

  if (!directory) {
    throw new Error(
      `[Swagger Initialization Error] Cannot locate modular OpenAPI sources. Attempted:\n${candidates.join('\n')}`,
    );
  }
  return directory;
}

function readYamlFile(filePath: string): YamlObject {
  try {
    return asYamlObject(YAML.parse(fs.readFileSync(filePath, 'utf8')), 'file content');
  } catch (error) {
    throw new Error(
      `[Swagger Initialization Error] Failed to read or parse '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function mergeUnique(target: YamlObject, source: YamlObject, description: string): void {
  for (const [name, value] of Object.entries(source)) {
    if (Object.hasOwn(target, name)) {
      throw new Error(`[Swagger Initialization Error] Duplicate ${description}: '${name}'.`);
    }
    target[name] = value;
  }
}

function validateOperationIds(document: OpenApiDocument): void {
  const operationIds = new Set<string>();

  for (const [route, pathItemValue] of Object.entries(document.paths)) {
    const pathItem = asYamlObject(pathItemValue, `path '${route}'`);
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!operationValue || typeof operationValue !== 'object' || Array.isArray(operationValue)) {
        continue;
      }

      const operation = operationValue as YamlObject;
      const operationId = operation.operationId;
      if (typeof operationId !== 'string') continue;
      if (operationIds.has(operationId)) {
        throw new Error(
          `[Swagger Initialization Error] Duplicate operationId '${operationId}' at ${method.toUpperCase()} ${route}.`,
        );
      }
      operationIds.add(operationId);
    }
  }
}

function resolveLocalReference(document: OpenApiDocument, reference: string): unknown {
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as YamlObject)[part];
    }, document);
}

function validateLocalReferences(document: OpenApiDocument): void {
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const object = value as YamlObject;
    const reference = object.$ref;
    if (
      typeof reference === 'string' &&
      reference.startsWith('#/') &&
      resolveLocalReference(document, reference) === undefined
    ) {
      throw new Error(`[Swagger Initialization Error] Unresolved local reference '${reference}'.`);
    }
    Object.values(object).forEach(visit);
  }

  visit(document);
}

export function loadOpenApiDocument(): { document: OpenApiDocument; rawYaml: string } {
  const directory = resolveOpenApiDirectory();
  const document = readYamlFile(path.join(directory, 'meta.yaml')) as OpenApiDocument;
  document.paths = {};
  document.components = {};

  for (const moduleName of moduleNames) {
    const fragment = readYamlFile(path.join(directory, `${moduleName}.yaml`));
    const paths = asYamlObject(fragment.paths ?? {}, `${moduleName} paths`);
    mergeUnique(document.paths, paths, 'path');
  }

  for (const componentName of componentNames) {
    const filePath = path.join(directory, 'components', `${componentName}.yaml`);
    if (!fs.existsSync(filePath)) continue;

    const fragment = readYamlFile(filePath);
    const components = asYamlObject(fragment.components ?? {}, `${componentName} components`);
    for (const [sectionName, sectionValue] of Object.entries(components)) {
      const section = asYamlObject(sectionValue, `${sectionName} components`);
      const existingSection = document.components[sectionName];
      const target = existingSection
        ? asYamlObject(existingSection, `merged ${sectionName} components`)
        : {};
      document.components[sectionName] = target;
      mergeUnique(target, section, `${sectionName} component`);
    }
  }

  validateOperationIds(document);
  validateLocalReferences(document);
  return { document, rawYaml: YAML.stringify(document, { lineWidth: 0 }) };
}
