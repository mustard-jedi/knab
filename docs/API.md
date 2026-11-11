# Knab API

Base URL: `http://YOUR_SERVER/api/v1`

- Interactive reference: `/api/docs`
- OpenAPI document: `/api/v1/openapi.json`
- JSON Schemas (no login needed): `/api/v1/schema/transaction`,
  `/api/v1/schema/transfer`, `/api/v1/schema/recurring`

## Authentication

Create a token in the web app under **Settings → API tokens** and send it with
every request:

```
Authorization: Bearer knab_xxxxxxxx
```

A token belongs to one budget, so requests never name a budget. Revoke a token
on the same screen.

## Create a transaction

`POST /api/v1/transactions`

The payload is flat: every field is a plain string, number or boolean. There are
no nested objects, no IDs, and amounts are never negative.

| Field | Type | Required | Rules |
|---|---|---|---|
| `amount` | number | yes | Greater than 0, at most 2 decimals. Example: `12.5` |
| `type` | string | yes | Exactly `"expense"` (money spent) or `"income"` (money received) |
| `account` | string | yes | Account name. Not case-sensitive |
| `category` | string | for expenses | Category name. Not case-sensitive. Leave out for income to send it to Ready to Assign |
| `date` | string | no | `YYYY-MM-DD`. Defaults to today |
| `payee` | string | no | Who was paid, or who paid |
| `memo` | string | no | Free-text note |
| `cleared` | boolean | no | `true` if settled at the bank. Defaults to `false` |

Any other field is rejected.

### JSON Schema

```json
{
  "title": "TransactionCreate",
  "type": "object",
  "additionalProperties": false,
  "required": ["amount", "type", "account"],
  "properties": {
    "date": { "type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    "amount": { "type": "number", "exclusiveMinimum": 0 },
    "type": { "type": "string", "enum": ["expense", "income"] },
    "account": { "type": "string", "minLength": 1 },
    "category": { "type": "string" },
    "payee": { "type": "string", "maxLength": 200 },
    "memo": { "type": "string", "maxLength": 500 },
    "cleared": { "type": "boolean" }
  }
}
```

The live copy at `/api/v1/schema/transaction` also carries a description and
examples for each field.

### Examples

"Spent 12.50 on groceries at Corner Market from checking":

```bash
curl -X POST http://localhost:3000/api/v1/transactions \
  -H "Authorization: Bearer $KNAB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 12.50, "type": "expense", "account": "Checking", "category": "Groceries", "payee": "Corner Market"}'
```

"Got paid 2500 on January 23":

```json
{ "date": "2026-01-23", "amount": 2500, "type": "income", "account": "Checking", "payee": "Employer" }
```

Success returns `201` and the saved transaction:

```json
{
  "id": 42, "date": "2026-01-23", "amount": 12.5, "type": "expense", "signed_amount": -12.5,
  "account": "Checking", "category": "Groceries", "payee": "Corner Market", "memo": "",
  "cleared": false, "transfer_account": null, "opening_balance": false, "recurring_id": null
}
```

### Errors

Every error is `{"error": "<code>", "message": "<what to fix>"}` with status
`400` for a bad payload and `401` for a missing or wrong token. When a name is
wrong, the valid names are included so the caller can retry:

```json
{
  "error": "unknown_account",
  "message": "There is no account named \"Chequing\". Valid accounts: Checking, Savings, Visa.",
  "field": "account",
  "valid_accounts": ["Checking", "Savings", "Visa"]
}
```

| Code | Meaning |
|---|---|
| `validation_error` | Missing field, unknown field, wrong type, or `type` not `expense`/`income` |
| `unknown_account` | No account with that name (see `valid_accounts`) |
| `unknown_category` | No category with that name (see `valid_categories`) |
| `category_required` | An expense was sent without a category (see `valid_categories`) |
| `invalid_amount` | More than 2 decimal places |
| `invalid_date` | Not a real `YYYY-MM-DD` date |

### Prompt for a small local model

This works well with models such as Gemma or Phi. Fill in the two lists from
`GET /accounts` and `GET /categories`.

```
Convert the user's message into one JSON object and output only the JSON.
Fields:
- "amount": positive number, no currency symbol
- "type": "expense" or "income"
- "account": one of [Checking, Savings, Visa]
- "category": one of [Groceries, Dining Out, Transport, ...]; omit for income
- "payee": short name of the shop or person (optional)
- "date": YYYY-MM-DD, only if the user gave a date
Do not add any other fields.
```

## Other endpoints

| Method and path | Purpose |
|---|---|
| `GET /accounts` | Accounts with balances |
| `GET /categories` | Category groups and categories |
| `GET /transactions?account=&category=&from=&to=&q=&limit=&offset=` | List transactions, newest first |
| `PATCH /transactions/{id}` | Change a transaction (send only the fields to change) |
| `DELETE /transactions/{id}` | Delete a transaction |
| `POST /transfers` | Move money: `{"amount": 100, "from_account": "Checking", "to_account": "Savings"}` |
| `GET /recurring`, `POST /recurring` | Recurring transactions: the transaction fields plus `"frequency"`: `weekly`, `biweekly`, `monthly` or `yearly`, and optional `"end_date"` |
| `POST /recurring/{id}/skip`, `DELETE /recurring/{id}` | Skip the next occurrence, or stop the schedule |
| `GET /budget?period=YYYY-MM` | Assigned, activity and available per category |
| `PUT /budget/assign` | `{"category": "Groceries", "amount": 400, "period": "2026-01"}` |
| `GET /reports/spending?from=&to=` | Spending by category |
| `GET /reports/trend?count=12` | Income, spending and net worth per period |

## Command-line client

`bin/knab.js` wraps the API for scripts and for models that run shell commands.
It needs only Node.js; copy the single file anywhere or run `npm link` in the
project to get a `knab` command.

```bash
export KNAB_URL=http://localhost:3000
export KNAB_TOKEN=knab_xxxxxxxx

knab add --amount 12.50 --type expense --account Checking --category Groceries --payee "Corner Market"
knab add --amount 2500 --type income --account Checking
knab transfer --amount 100 --from Checking --to Savings
knab accounts
knab categories
knab budget --period 2026-01
knab recent --limit 10
knab schema
```

Output is JSON on success (exit code 0). On an error it prints one line such as
`Error (unknown_account): There is no account named "Chequing". Valid accounts: Checking, Savings, Visa.`
and exits with code 1.
