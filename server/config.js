import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig() {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  return {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '127.0.0.1',
    dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/knab.sqlite'),
    // Set true once the app is served over HTTPS so the session cookie is HTTPS-only.
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    // Set true behind nginx/Caddy so rate limiting sees the real client IP.
    trustProxy: process.env.TRUST_PROXY === 'true',
    logger: process.env.LOG !== 'false',
  };
}
