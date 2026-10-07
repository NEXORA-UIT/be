let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) throw new Error('DATABASE_URL or POSTGRES_PASSWORD is required');

  const user = process.env.POSTGRES_USER ?? 'nexora';
  const database = process.env.POSTGRES_DB ?? 'nexora';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedDatabase = encodeURIComponent(database);
  databaseUrl = `postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:${port}/${encodedDatabase}`;
}

// Prisma Client and CLI share the same resolved connection URL.
process.env.DATABASE_URL = databaseUrl;
export const databaseConfig = { url: databaseUrl };
