// JSON Schemas for the public write endpoints.
//
// These are deliberately flat: every field is a plain string, number or
// boolean. No nesting, no oneOf/anyOf, no signed amounts, no numeric IDs.
// That keeps them easy for small local models (Gemma, Phi, ...) to fill in.

const date = {
  type: 'string',
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  description: 'Calendar date in YYYY-MM-DD format. If omitted, today is used.',
  examples: ['2026-01-23'],
};

const amount = {
  type: 'number',
  exclusiveMinimum: 0,
  description: 'Always a positive number with at most 2 decimal places. Never negative: use "type" to say whether money went out or came in.',
  examples: [12.5],
};

const txFields = {
  date,
  amount,
  type: {
    type: 'string',
    enum: ['expense', 'income'],
    description: '"expense" = money spent (leaves the account). "income" = money received (enters the account).',
  },
  account: {
    type: 'string',
    minLength: 1,
    description: 'Name of the account, exactly as it appears in GET /api/v1/accounts. Not case-sensitive.',
    examples: ['Checking'],
  },
  category: {
    type: 'string',
    description: 'Name of the budget category, as it appears in GET /api/v1/categories. Not case-sensitive. Required when type is "expense". Optional when type is "income" (leave it out and the money goes to Ready to Assign).',
    examples: ['Groceries'],
  },
  payee: {
    type: 'string',
    maxLength: 200,
    description: 'Who was paid, or who paid you. Optional.',
    examples: ['Corner Market'],
  },
  memo: {
    type: 'string',
    maxLength: 500,
    description: 'Free-text note. Optional.',
  },
  cleared: {
    type: 'boolean',
    description: 'true if the transaction has already settled at the bank. Optional, defaults to false.',
  },
};

const flag = {
  type: 'string',
  description: 'Name of a coloured flag, as it appears in GET /api/v1/flags. Not case-sensitive. Optional. Send an empty string to remove the flag.',
  examples: ['Red'],
};

export const transactionCreate = {
  title: 'TransactionCreate',
  description: 'Payload for POST /api/v1/transactions. Creates one expense or income transaction.',
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'type', 'account'],
  properties: { ...txFields, flag },
  examples: [
    { date: '2026-01-23', amount: 12.5, type: 'expense', account: 'Checking', category: 'Groceries', payee: 'Corner Market' },
    { amount: 2500, type: 'income', account: 'Checking', payee: 'Employer' },
  ],
};

export const transactionUpdate = {
  title: 'TransactionUpdate',
  description: 'Payload for PATCH /api/v1/transactions/{id}. Send only the fields to change.',
  type: 'object',
  additionalProperties: false,
  properties: { ...txFields, flag },
};

export const transferCreate = {
  title: 'TransferCreate',
  description: 'Payload for POST /api/v1/transfers. Moves money between two of your own accounts.',
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'from_account', 'to_account'],
  properties: {
    date,
    amount,
    from_account: { type: 'string', minLength: 1, description: 'Name of the account the money leaves.' },
    to_account: { type: 'string', minLength: 1, description: 'Name of the account the money enters.' },
    memo: txFields.memo,
    flag,
  },
};

const frequency = {
  type: 'string',
  enum: ['weekly', 'biweekly', 'monthly', 'yearly'],
  description: 'How often the transaction repeats.',
};

const endDate = {
  type: 'string',
  description: 'Last date the schedule may post, in YYYY-MM-DD format. Optional. Send an empty string to remove it.',
};

export const recurringCreate = {
  title: 'RecurringCreate',
  description: 'Payload for POST /api/v1/recurring. "date" is the first occurrence; if it is today or earlier it is posted immediately.',
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'type', 'account', 'frequency'],
  properties: { ...txFields, frequency, end_date: endDate },
};

export const recurringUpdate = {
  title: 'RecurringUpdate',
  type: 'object',
  additionalProperties: false,
  properties: { ...txFields, frequency, end_date: endDate },
};

export const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Machine-readable error code.' },
    message: { type: 'string', description: 'Plain-language explanation of what to fix.' },
  },
  additionalProperties: true,
};
