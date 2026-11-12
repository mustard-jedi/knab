# Using Knab from Claude (MCP)

Knab ships a Model Context Protocol server, so Claude and other MCP clients can
read your budget and record transactions when you ask them to.

It runs on your own computer, started by the client, and talks to your Knab
server over the normal API with an API token. It can do exactly what that token
can do: one budget, nothing else.

## 1. Create a token

In Knab, open **Settings > API tokens**, create a token for the budget you want
Claude to use, and copy it. It is shown only once.

## 2. Add it to your client

You need Node.js 20 or newer and a copy of `bin/knab-mcp.js` (a single file with
no dependencies). Replace the path, address and token below with your own.

**Claude Code**

```bash
claude mcp add knab --env KNAB_URL=https://budget.example.com --env KNAB_TOKEN=knab_xxxxxxxx -- node /path/to/knab/bin/knab-mcp.js
```

**Claude Desktop**: add this to `claude_desktop_config.json` (Settings >
Developer > Edit Config) and restart the app:

```json
{
  "mcpServers": {
    "knab": {
      "command": "node",
      "args": ["/path/to/knab/bin/knab-mcp.js"],
      "env": {
        "KNAB_URL": "https://budget.example.com",
        "KNAB_TOKEN": "knab_xxxxxxxx"
      }
    }
  }
}
```

`knab mcp` starts the same server if you have the `knab` command installed.
The address and token can also come from `~/.config/knab/config.json`, as for
the command-line client.

## Tools

| Tool | What it does |
|---|---|
| `read_manual` | The user manual ([MANUAL.md](MANUAL.md)): lists its questions, or returns the sections matching a topic |
| `list_accounts` | Accounts with type and balance |
| `list_categories` | Category groups and their categories |
| `list_flags` | Flags and how many transactions use each |
| `get_budget` | Ready to Assign, and assigned, activity and available per category for a period |
| `list_transactions` | Transactions, newest first, filtered by account, category, flag, dates or text |
| `spending_report` | Spending per category and income per payee, per period |
| `net_worth_report` | Income, spending, assets, debts and net worth per period |
| `add_transaction` | Record an expense or income |
| `add_transfer` | Move money between two accounts |
| `update_transaction` | Change a transaction (by id) |
| `assign_budget` | Set the amount assigned to a category for a period |

There is deliberately no tool that deletes anything, and none for accounts,
categories, users or settings.

## Read-only mode

Set `KNAB_MCP_READONLY=1` in the server's environment to leave out the last
four tools (the ones that add or change data). Claude can then look but not change anything.

## Things to know

- Anything Claude reads elsewhere (a web page, an email) could try to talk it
  into calling these tools. Keep your client's per-call approval on for the
  tools that write, or use read-only mode.
- This server uses the stdio transport, so it works with clients that can start
  a local program. It is not a remote connector: the Claude mobile and web apps
  cannot reach it.
