import '../../config/database/database.config.js';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['query', 'error'],
});
