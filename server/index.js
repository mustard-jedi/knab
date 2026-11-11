import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { postDueRecurring } from './ledger.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp({ db, config });

function housekeeping() {
  try {
    const posted = postDueRecurring(db);
    if (posted) app.log.info(`Posted ${posted} recurring transaction(s)`);
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  } catch (err) {
    app.log.error(err);
  }
}

housekeeping();
// Hourly, so a recurring transaction posts soon after midnight on its due date.
const timer = setInterval(housekeeping, 60 * 60 * 1000);
timer.unref();

async function shutdown() {
  clearInterval(timer);
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
