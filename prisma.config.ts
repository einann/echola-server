import path from 'node:path';
import { defineConfig, env } from 'prisma/config';
import { config } from 'dotenv';

config();

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  engine: 'classic',
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
  schema: path.join('prisma', 'schema.prisma'),
});
