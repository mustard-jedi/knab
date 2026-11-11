import { hash, verify } from '@node-rs/argon2';
import { HttpError, sha256, newToken } from './util.js';

export const SESSION_COOKIE = 'knab_session';
const SESSION_DAYS = 30;

export const hashPassword = (password) => hash(password);

// Verified against when the username does not exist, so a failed login takes
// about the same time either way.
const dummyHash = hash('not-a-real-password');

export async function checkPassword(storedHash, password) {
  try {
    return await verify(storedHash ?? (await dummyHash), password) && Boolean(storedHash);
  } catch {
    return false;
  }
}

export function startSession(app, reply, userId) {
  const token = newToken();
  app.db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .run(sha256(token), userId, `+${SESSION_DAYS} days`);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: app.config.cookieSecure,
    maxAge: SESSION_DAYS * 86400,
  });
}

export function endSession(app, request, reply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) app.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

// onRequest hook: accepts either an API token (Authorization: Bearer ...) or
// the browser session cookie.
export function authenticate(app) {
  const db = app.db;
  const byToken = db.prepare(
    `SELECT t.id AS token_id, t.budget_id, u.id, u.username, u.is_admin
     FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
  );
  const touchToken = db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?");
  const bySession = db.prepare(
    `SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  );

  return async function (request) {
    const header = request.headers.authorization;
    if (header) {
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const row = match && byToken.get(sha256(match[1]));
      if (!row) throw new HttpError(401, 'invalid_token', 'The API token is missing or not valid.');
      touchToken.run(row.token_id);
      request.user = { id: row.id, username: row.username, is_admin: Boolean(row.is_admin) };
      request.tokenBudgetId = row.budget_id;
      return;
    }
    const cookie = request.cookies[SESSION_COOKIE];
    const row = cookie && bySession.get(sha256(cookie));
    if (!row) throw new HttpError(401, 'not_signed_in', 'Sign in, or send an API token in the Authorization header.');
    request.user = { id: row.id, username: row.username, is_admin: Boolean(row.is_admin) };
  };
}

// Account-level routes (users, tokens, budget management) are browser-only.
export function requireSession(request) {
  if (request.tokenBudgetId) {
    throw new HttpError(403, 'session_required', 'This endpoint cannot be used with an API token.');
  }
}

export function requireAdmin(request) {
  requireSession(request);
  if (!request.user.is_admin) throw new HttpError(403, 'admin_required', 'Only an admin can do this.');
}

// Resolves the budget a request operates on: the token's budget, or the
// X-Budget-Id header for browser sessions. Checks the user may access it.
export function resolveBudget(app, request, { ownerOnly = false } = {}) {
  const id = request.tokenBudgetId ?? Number(request.headers['x-budget-id']);
  if (!id) throw new HttpError(400, 'budget_required', 'No budget selected. Send the X-Budget-Id header.');
  const budget = app.db
    .prepare(
      `SELECT b.* FROM budgets b WHERE b.id = ? AND (b.owner_id = ? OR EXISTS
         (SELECT 1 FROM budget_members m WHERE m.budget_id = b.id AND m.user_id = ?))`,
    )
    .get(id, request.user.id, request.user.id);
  if (!budget) throw new HttpError(404, 'budget_not_found', 'That budget does not exist or you do not have access to it.');
  if (ownerOnly && budget.owner_id !== request.user.id) {
    throw new HttpError(403, 'owner_required', 'Only the budget owner can do this.');
  }
  return budget;
}
