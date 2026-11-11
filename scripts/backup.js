#!/usr/bin/env node
// Writes a consistent copy of the database to backups/ (safe while the server
// is running) and keeps the newest 14. Run nightly from cron; see README.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig, ROOT } from '../server/config.js';

const KEEP = 14;
const { dbPath } = loadConfig();
if (!fs.existsSync(dbPath)) {
  console.log(`No database at ${dbPath} yet; nothing to back up.`);
  process.exit(0);
}

const dir = path.resolve(ROOT, process.env.BACKUP_DIR || 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dest = path.join(dir, `knab-${stamp}.sqlite`);

const db = new Database(dbPath, { readonly: true });
await db.backup(dest);
db.close();
console.log(`Backed up to ${dest}`);

const old = fs.readdirSync(dir).filter((f) => /^knab-.*\.sqlite$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) fs.unlinkSync(path.join(dir, f));
