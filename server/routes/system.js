// Sign-in, users, budgets, sharing and API tokens.
import {
  hashPassword, checkPassword, startSession, endSession,
  authenticate, requireSession, requireAdmin,
} from '../auth.js';
import { DEFAULT_FLAGS } from '../../shared/flags.js';
import { HttpError, sha256, newToken } from '../util.js';

const credentials = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', pattern: '^[A-Za-z0-9_.-]{3,32}$' },
    password: { type: 'string', minLength: 8, maxLength: 200 },
    is_admin: { type: 'boolean' },
  },
};

const DEFAULT_CATEGORIES = [
  ['Bills', ['Rent / Mortgage', 'Utilities', 'Internet', 'Phone']],
  ['Everyday', ['Groceries', 'Dining Out', 'Transport', 'Household']],
  ['Savings', ['Emergency Fund']],
  ['Fun', ['Entertainment']],
];

export function publicRoutes(app) {
  const db = app.db;
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  app.get('/status', async () => ({ needs_setup: userCount() === 0 }));

  // First run only: creates the admin account.
  app.post('/setup', { ...loginLimit, schema: { body: credentials } }, async (request, reply) => {
    if (userCount() > 0) throw new HttpError(409, 'already_set_up', 'Setup has already been completed.');
    const { username, password } = request.body;
    const info = db
      .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)')
      .run(username, await hashPassword(password));
    startSession(app, reply, info.lastInsertRowid);
    return { id: info.lastInsertRowid, username, is_admin: true };
  });

  app.post('/auth/login', {
    ...loginLimit,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['username', 'password'],
        properties: { username: { type: 'string' }, password: { type: 'string', maxLength: 200 } },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!(await checkPassword(user?.password_hash, password))) {
      throw new HttpError(401, 'invalid_login', 'Wrong username or password.');
    }
    startSession(app, reply, user.id);
    return { id: user.id, username: user.username, is_admin: Boolean(user.is_admin) };
  });

  app.post('/auth/logout', async (request, reply) => {
    endSession(app, request, reply);
    return { ok: true };
  });
}

export function systemRoutes(app) {
  const db = app.db;

  app.get('/auth/me', async (request) => ({ ...request.user, token_budget_id: request.tokenBudgetId ?? null }));

  app.post('/auth/password', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['current_password', 'new_password'],
        properties: {
          current_password: { type: 'string', maxLength: 200 },
          new_password: { type: 'string', minLength: 8, maxLength: 200 },
        },
      },
    },
  }, async (request) => {
    requireSession(request);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);
    if (!(await checkPassword(user.password_hash, request.body.current_password))) {
      throw new HttpError(400, 'wrong_password', 'The current password is not correct.');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(request.body.new_password), user.id);
    return { ok: true };
  });

  // ---- Users (admin) ----

  app.get('/users', async (request) => {
    requireAdmin(request);
    return db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY username').all()
      .map((u) => ({ ...u, is_admin: Boolean(u.is_admin) }));
  });

  app.post('/users', { schema: { body: credentials } }, async (request, reply) => {
    requireAdmin(request);
    const { username, password, is_admin = false } = request.body;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, 'username_taken', `The username "${username}" is already in use.`);
    }
    const info = db
      .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
      .run(username, await hashPassword(password), is_admin ? 1 : 0);
    reply.code(201);
    return { id: info.lastInsertRowid, username, is_admin };
  });

  app.post('/users/:id/password', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['new_password'],
        properties: { new_password: { type: 'string', minLength: 8, maxLength: 200 } },
      },
    },
  }, async (request) => {
    requireAdmin(request);
    const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(await hashPassword(request.body.new_password), request.params.id);
    if (!info.changes) throw new HttpError(404, 'user_not_found', 'No such user.');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(request.params.id);
    return { ok: true };
  });

  // Deleting a user also deletes the budgets they own.
  app.delete('/users/:id', async (request) => {
    requireAdmin(request);
    if (Number(request.params.id) === request.user.id) {
      throw new HttpError(400, 'cannot_delete_self', 'You cannot delete your own user.');
    }
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(request.params.id);
    if (!info.changes) throw new HttpError(404, 'user_not_found', 'No such user.');
    return { ok: true };
  });

  // ---- Budgets ----

  const budgetShape = (b, userId) => ({
    id: b.id, name: b.name, currency: b.currency, cutoff_day: b.cutoff_day,
    is_owner: b.owner_id === userId, owner: b.owner,
  });

  const ownedBudget = (request) => {
    requireSession(request);
    const b = db.prepare('SELECT * FROM budgets WHERE id = ?').get(request.params.id);
    if (!b || b.owner_id !== request.user.id) {
      throw new HttpError(404, 'budget_not_found', 'That budget does not exist or you are not its owner.');
    }
    return b;
  };

  app.get('/budgets', async (request) => {
    const rows = db.prepare(
      `SELECT b.*, u.username AS owner FROM budgets b JOIN users u ON u.id = b.owner_id
       WHERE (b.owner_id = @uid OR EXISTS (SELECT 1 FROM budget_members m WHERE m.budget_id = b.id AND m.user_id = @uid))
         AND (@only IS NULL OR b.id = @only)
       ORDER BY b.name`,
    ).all({ uid: request.user.id, only: request.tokenBudgetId ?? null });
    return rows.map((b) => budgetShape(b, request.user.id));
  });

  const budgetBody = {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    cutoff_day: { type: 'integer', minimum: 1, maximum: 31 },
  };

  app.post('/budgets', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { ...budgetBody, seed_categories: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => {
    requireSession(request);
    const { name, currency = 'USD', cutoff_day = 1, seed_categories = true } = request.body;
    const id = db.transaction(() => {
      const budgetId = db
        .prepare('INSERT INTO budgets (owner_id, name, currency, cutoff_day) VALUES (?, ?, ?, ?)')
        .run(request.user.id, name.trim(), currency.toUpperCase(), cutoff_day).lastInsertRowid;
      if (seed_categories) {
        DEFAULT_CATEGORIES.forEach(([group, names], gi) => {
          const groupId = db.prepare('INSERT INTO category_groups (budget_id, name, sort) VALUES (?, ?, ?)')
            .run(budgetId, group, gi).lastInsertRowid;
          names.forEach((n, ci) => db
            .prepare('INSERT INTO categories (budget_id, group_id, name, sort) VALUES (?, ?, ?, ?)')
            .run(budgetId, groupId, n, ci));
        });
      }
      DEFAULT_FLAGS.forEach(([flag, color], i) => db
        .prepare('INSERT INTO flags (budget_id, name, color, sort) VALUES (?, ?, ?, ?)').run(budgetId, flag, color, i));
      return budgetId;
    })();
    reply.code(201);
    return { id, name: name.trim(), currency: currency.toUpperCase(), cutoff_day, is_owner: true, owner: request.user.username };
  });

  // Changing cutoff_day needs no data migration: periods are computed on read.
  app.patch('/budgets/:id', {
    schema: { body: { type: 'object', additionalProperties: false, properties: budgetBody } },
  }, async (request) => {
    const b = ownedBudget(request);
    const next = { ...b, ...request.body };
    db.prepare('UPDATE budgets SET name = ?, currency = ?, cutoff_day = ? WHERE id = ?')
      .run(next.name.trim(), next.currency.toUpperCase(), next.cutoff_day, b.id);
    return { ok: true };
  });

  app.delete('/budgets/:id', async (request) => {
    const b = ownedBudget(request);
    db.prepare('DELETE FROM budgets WHERE id = ?').run(b.id);
    return { ok: true };
  });

  // ---- Sharing ----

  app.get('/budgets/:id/members', async (request) => {
    const b = ownedBudget(request);
    return db.prepare(
      'SELECT u.id, u.username FROM budget_members m JOIN users u ON u.id = m.user_id WHERE m.budget_id = ? ORDER BY u.username',
    ).all(b.id);
  });

  app.post('/budgets/:id/members', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['username'],
        properties: { username: { type: 'string', minLength: 1 } },
      },
    },
  }, async (request, reply) => {
    const b = ownedBudget(request);
    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(request.body.username.trim());
    if (!user) throw new HttpError(404, 'user_not_found', `There is no user named "${request.body.username}".`);
    if (user.id === b.owner_id) throw new HttpError(400, 'already_owner', 'You already own this budget.');
    db.prepare('INSERT OR IGNORE INTO budget_members (budget_id, user_id) VALUES (?, ?)').run(b.id, user.id);
    reply.code(201);
    return user;
  });

  app.delete('/budgets/:id/members/:userId', async (request) => {
    const b = ownedBudget(request);
    db.transaction(() => {
      db.prepare('DELETE FROM budget_members WHERE budget_id = ? AND user_id = ?').run(b.id, request.params.userId);
      db.prepare('DELETE FROM api_tokens WHERE budget_id = ? AND user_id = ?').run(b.id, request.params.userId);
    })();
    return { ok: true };
  });

  // ---- API tokens ----

  app.get('/tokens', async (request) => {
    requireSession(request);
    return db.prepare(
      `SELECT t.id, t.name, t.created_at, t.last_used_at, b.name AS budget, b.id AS budget_id
       FROM api_tokens t JOIN budgets b ON b.id = t.budget_id WHERE t.user_id = ? ORDER BY t.id DESC`,
    ).all(request.user.id);
  });

  app.post('/tokens', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'budget_id'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, budget_id: { type: 'integer' } },
      },
    },
  }, async (request, reply) => {
    requireSession(request);
    const { name, budget_id } = request.body;
    const allowed = db.prepare(
      `SELECT 1 FROM budgets b WHERE b.id = ? AND (b.owner_id = ? OR EXISTS
         (SELECT 1 FROM budget_members m WHERE m.budget_id = b.id AND m.user_id = ?))`,
    ).get(budget_id, request.user.id, request.user.id);
    if (!allowed) throw new HttpError(404, 'budget_not_found', 'That budget does not exist or you do not have access to it.');
    const token = newToken('knab_');
    const info = db.prepare('INSERT INTO api_tokens (user_id, budget_id, name, token_hash) VALUES (?, ?, ?, ?)')
      .run(request.user.id, budget_id, name.trim(), sha256(token));
    reply.code(201);
    // The token itself is only ever returned here; only its hash is stored.
    return { id: info.lastInsertRowid, name: name.trim(), token };
  });

  app.delete('/tokens/:id', async (request) => {
    requireSession(request);
    db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(request.params.id, request.user.id);
    return { ok: true };
  });
}

export { authenticate };
