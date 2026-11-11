import crypto from 'node:crypto';
import { isValidDate } from '../shared/periods.js';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.statusCode = status;
    this.code = code;
    this.extra = extra;
  }
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = (prefix = '') => prefix + crypto.randomBytes(32).toString('hex');

// Money is stored as integer cents and exposed as decimal numbers.
export function toCents(value, field = 'amount') {
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isFinite(value) || Math.abs(scaled - cents) > 1e-6) {
    throw new HttpError(400, 'invalid_amount', `"${field}" must be a number with at most 2 decimal places, for example 12.50.`);
  }
  if (Math.abs(cents) > 1e13) throw new HttpError(400, 'invalid_amount', `"${field}" is too large.`);
  return cents;
}

export const fromCents = (cents) => (cents || 0) / 100;

export function assertDate(value, field = 'date') {
  if (!isValidDate(value)) {
    throw new HttpError(400, 'invalid_date', `"${field}" must be a real calendar date in YYYY-MM-DD format, for example 2026-01-23.`);
  }
  return value;
}

export function assertLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, 'invalid_period', '"period" must be in YYYY-MM format, for example 2026-01.');
  }
  return value;
}
