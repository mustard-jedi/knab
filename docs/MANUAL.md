# Knab user manual

Knab is a self-hosted envelope budget for a household. You record what comes in
and goes out, give every unit of money a job by assigning it to a category, and
see where it went in the reports.

This manual is written as questions and answers so that a person, or an AI
assistant reading it, can look up one thing at a time. For installing and
deploying Knab see the README; for the API see API.md; for connecting Claude
see MCP.md.

## The ideas behind Knab

### What is envelope budgeting?

You only budget money you actually have. Money that arrives sits in **Ready to
Assign** until you assign it to categories such as Groceries or Rent. Spending
comes out of the category it belongs to. What a category has left is its
**Available** amount.

### What is Ready to Assign?

Money you have that is not yet in any category. Income recorded without a
category goes there. Assigning money to categories brings it down. The goal is
zero: every unit of money has a job.

### Why is Ready to Assign negative?

You have assigned more than you have. Lower the assigned amount of one or more
categories until it is back to zero. Common causes: assigning in advance of
income that has not arrived, deleting or reducing an income transaction, or
assigning money in a future period.

### What do Assigned, Activity and Available mean?

- **Assigned**: what you put into the category in this period.
- **Activity**: the category's transactions in this period. Spending is
  negative; a refund is positive.
- **Available**: everything ever assigned to the category plus all of its
  transactions up to the end of this period. It is the running balance of the
  envelope.

### What happens to money I do not spend?

It stays in the category and carries into the next period as part of
Available.

### What happens when I overspend a category?

Available goes negative, shown in red, and the negative amount carries into the
next period until you cover it by assigning more to that category. Knab does
not move the overspending anywhere else on its own. (This differs from YNAB,
which takes cash overspending out of next month's Ready to Assign.)

### How does the budget relate to my account balances?

Ready to Assign plus the Available of every category always equals the total of
all your account balances. Transfers between your own accounts never change the
budget.

### How do credit cards work?

A credit card is an ordinary account with a negative balance: what you owe.
Buying something on the card is an expense in the card account, and it comes
out of its category at the time of purchase. Paying the card is a transfer from
your bank account to the card account and does not touch the budget. There is
no separate "credit card payment" category.

### Is there more than one currency?

No. Each budget has one currency, chosen when the budget is created.

## Budget periods and the cutoff day

### What is a budget period?

The date range one budget "month" covers. Each budget has a **Period starts on
day** setting. With day 1, periods are calendar months. With day 23, a period
runs from the 23rd of one month to the 22nd of the next, which suits people
paid on the 23rd.

### How are periods named?

After the month they start in. With day 23, the period `2026-01` is
Jan 23 - Feb 22, 2026. Screens show the dates; the API and the MCP tools use
the `YYYY-MM` label.

### What if the start day does not exist in a month?

Days 29, 30 and 31 fall back to the last day of shorter months. With day 31,
the February period starts on Feb 28 (or 29).

### How do I change the period start day?

Settings > This budget > Period starts on day. Only the budget's owner can
change it.

### What happens to my history when I change it?

Transactions are re-sorted into the new date ranges straight away, so Activity
per period changes. Assigned amounts stay with their period name: money
assigned to `2026-01` is still assigned to `2026-01`, which now covers
different dates. Account balances and Available totals over time are unaffected.

## Getting started

### How do I sign in for the first time?

The first person to open a new Knab installation creates the admin account.
There is no public sign-up: after that, only the admin can add users, under
Settings > Users.

### How do I create a budget?

After signing in with no budgets you are asked for a name, a three-letter
currency code and the period start day. Later, use Settings > Budgets and
data > New budget. A new budget starts with a few common categories and six
flags, all of which you can change.

### How do I switch between budgets?

If you have access to more than one, pick it from the list at the top of the
sidebar (the top of the screen on a phone).

### What should I set up first?

1. Add each account you spend from, with its balance today.
2. Those balances appear in Ready to Assign. Assign them to categories on the
   Budget page until Ready to Assign is zero.
3. From then on, record transactions as they happen.

## Accounts

### How do I add an account?

Use **Add account** in the sidebar, or the Accounts page. Give it a name, a
type (Checking, Savings, Cash, Credit card or Other), its current balance and
the date of that balance. For a credit card, enter what you owe as a negative
number, for example -350.00.

### How do I rename, close or delete an account?

Open the account and press **Edit**, or use Manage accounts in the sidebar.
Closing an account hides it when adding transactions but keeps its history.
Prefer closing to deleting.

### What are the Cash and Credit sections in the sidebar?

Credit lists credit card accounts; Cash lists everything else. Each shows its
total. A negative balance is shown in a red pill.

### What are the Cleared, Uncleared and Working balances?

- **Cleared**: transactions the bank has processed (you marked them cleared).
- **Uncleared**: transactions you recorded that have not settled yet.
- **Working**: the two added together; what the account will hold once
  everything settles.

## Transactions

### How do I add a transaction?

Press **Add transaction** in the sidebar, or the round + button at the bottom
of a phone screen. Choose Expense, Income or Transfer, then enter the amount,
date, account, payee, category and an optional memo and flag. The amount is
always entered as a positive number; the type says which way the money went.

### Does an expense need a category?

Yes. Income does not: leave its category as Ready to Assign for pay and other
ordinary income. Give income a category only when it is really a refund that
should go back into that category.

### How do I record a transfer between my accounts?

Add a transaction, choose **Transfer**, and pick the account the money leaves
and the account it enters. Knab creates both sides. Transfers need no category.

### How do I pay off a credit card?

Record a transfer from the bank account to the credit card account.

### How do I edit or delete a transaction?

Click or tap its row in the register. Deleting a transfer removes both sides.
A transfer's accounts cannot be changed afterwards; delete it and create a new
one.

### How do I mark a transaction as cleared?

Press the round **C** at the end of its row, or tick "Cleared at the bank" in
the form. Press it again to undo.

### How do I find a transaction?

Open All accounts or a single account. Use the search box (it looks in payee,
memo and category), the flag filter, and the dates menu: By period, Custom
dates or All dates. Clicking a category's Activity on the Budget page, or a
category in the Spending Breakdown report, opens the matching transactions.

### How do I resize the columns in the register?

On a computer, drag the right edge of a column heading. Double-click an edge to
reset that column, or use "Reset column widths" under the table. Widths are
remembered in that browser only. Memo takes whatever space is left.

### How do I export my transactions?

Settings > Budgets and data > Export transactions (CSV).

### Can I import a bank file or connect my bank?

No. Knab has no bank connections and cannot import bank or YNAB files. The only
file it imports is its own budget backup (see "Backup and restore").
Transactions are entered by hand, through the API, the command line, or an AI
assistant using MCP.

## Flags

### What are flags?

Coloured labels for transactions, for whatever you want to track: to
reimburse, to check, tax-related. A transaction has at most one flag.

### How do I flag a transaction?

Pick a flag in the transaction form. Choose None to remove it.

### How do I add, rename, recolour or remove a flag?

Press **Flags** above the register, or "Edit flags" in the transaction form.
Each budget has its own list; add as many as you need. Nine colours are
available. Removing a flag leaves its transactions unflagged; the number next
to each flag shows how many transactions use it.

### How do I see only flagged transactions?

Choose the flag in the "All flags" menu above the register.

## Categories and groups

### How do I add a category or a group?

On the Budget page, **+ Category group** adds a group, and the + next to a
group's name adds a category to it.

### How do I rename, hide or delete a category?

Click its name on the Budget page. A category with transactions cannot be
deleted; hide it instead and its history is kept. A group can be deleted once
it has no categories.

### How do I reorder categories or move one to another group?

Drag the grip (the dotted handle at the left of the row) up or down, or onto a
row in another group. Dropping on a group's heading puts the category at the
top of that group, or at the end if the group is collapsed. Drag a group's own
grip to move the whole group. With a grip focused, the up and down arrow keys
do the same. Grips only appear on the All filter. The order is saved for
everyone who shares the budget.

### Does moving a category change my money?

No. Its assigned amounts, activity and history stay with it. Reports that total
by group show it under its new group, including for past periods.

### How do I see hidden categories?

Use the **Hidden** filter on the Budget page, then click one and choose "Show
again". A hidden category that still holds money stays visible on All.

## Assigning money

### How do I assign money to a category?

On the Budget page, type the amount in the category's Assigned box and press
Enter or leave the box. The amount is the total for that period; it replaces
what was there.

### How do I plan a different period?

Use the arrows next to the period dates at the top of the Budget page. "Back to
current" returns to today's period. Money assigned in a future period comes out
of Ready to Assign immediately.

### What does Quick assign do?

It fills only categories that have nothing assigned yet in the period shown:

- **Assigned last period** copies each category's previous assigned amount.
- **Spent last period** assigns what each category spent last period.
- **Reset assigned amounts** sets every assigned amount in the period to zero.

### What do the filters above the budget do?

All shows everything; Overspent shows categories with negative Available;
Money available shows those with a positive Available; Hidden shows hidden
categories.

### What is in the summary on the right?

"Left over from last period", "Assigned this period" and "Activity" add up to
"Available". "Assigned in future periods" is money already assigned to periods
after the one shown.

### Are there targets or goals?

No. Knab has no category targets, and no loan calculators.

## Recurring transactions

### How do I make a transaction repeat?

Add a transaction and choose a **Repeat** frequency: every week, every 2 weeks,
every month or every year. Optionally set an "Until" date. If the first date is
today or earlier, it is entered straight away.

### When are recurring transactions entered?

Automatically on their date. The server checks when it starts and every hour.
They arrive uncleared and without a flag.

### How do I change, skip or stop one?

Open **Scheduled**. "Skip next" skips the next occurrence; "Edit" changes the
schedule, and "Stop" inside it ends the schedule. Entries already made stay.

### Can a transfer repeat?

No. Recurring transfers are not supported.

## Reports

### Where are the reports?

**Reports** in the sidebar. There are five tabs. Each has arrows to step
earlier or later, a menu for how many periods to cover, and an **Export**
button that downloads the table as a CSV file. Reports use budget periods, not
calendar months, unless the period start day is 1.

### What does Spending Breakdown show?

Where the money went in the chosen periods: a ring chart of the five largest
categories (the rest are folded into "Other"), the average per period and per
day, the most frequent category, the largest single outflow, and every category
ranked. Switch between Categories and Groups, and filter by category, group or
account.

### What does Spending Trends show?

Total spending per period as bars, with a dashed line at the average, and a
table comparing each period to the average.

### What does Net Worth show?

Assets (accounts with a positive balance) and debts (accounts with a negative
balance) at the end of each period, net worth as a line, and the change from
one period to the next.

### What does Income v Expense show?

A table with one column per period, plus Average and Total: income by payee,
expenses by group and category, and net income at the bottom.

### What is Age of Money?

How long, on average, money sits in your accounts between arriving and being
spent. Knab spends your oldest money first and averages the age of your last
ten outflows. A rising number means you are living on older income. It counts
all accounts together, so it will not match YNAB's figure exactly.

### What counts as spending and income in reports?

Spending is every transaction that has a category; a refund in a category
reduces it. Income is money received without a category. Transfers and account
opening balances count as neither.

## Sharing and users

### How do I share a budget with a family member?

They need their own Knab user first: the admin creates it under Settings >
Users. Then the budget's owner opens Settings > Sharing and invites them by
username. They see the budget in their budget list straight away.

### What can someone I share with do?

Everything in that budget except change its name, currency or period start day,
delete it, or manage who it is shared with. Those belong to the owner.

### Can other users see my other budgets?

No. A budget is private to its owner until it is shared, and sharing is per
budget.

### How do I stop sharing?

Settings > Sharing, then remove the person.

### How do I change my password?

Settings, in the "Signed in as" section at the bottom. The admin can reset another user's password under
Settings > Users.

### What happens when a user is deleted?

Budgets they own are deleted with them. This cannot be undone.

## Backup and restore

### How do I back up a budget?

Settings > Budgets and data > **Export budget (backup file)**. It downloads one
file named like `Home-2026-11-12.knab.json`. Keep it somewhere safe; anyone who
has the file can read the whole budget.

### What is in the backup file?

Everything in that one budget: its name, currency and period start day,
accounts, category groups and categories in their order, flags, every
transaction (including transfers, cleared marks and flags), assigned amounts
for every period, and recurring transactions. It is a JSON text file.

### What is not in the backup file?

Users and passwords, who the budget is shared with, and API tokens. Other
budgets are not included either; export each one separately.

### How do I restore a budget from a backup file?

Settings > Budgets and data > **Import budget...** and choose the file. Knab
creates a new budget from it and switches you to it. You become its owner.

### Does importing overwrite my current budget?

No. Importing always creates a new budget and never changes an existing one.
If you already have a budget with the same name, the new one is called
"Name (imported)". Once you are happy with it you can delete the old one.

### What if the file is damaged or was edited by hand?

Knab checks the whole file first. If anything is wrong it imports nothing and
says what the problem is, for example a transaction that names an account that
is not in the file.

### Can I use a backup file to move a budget to another Knab server, or to copy one?

Yes to both. The file has no server-specific ids, so it loads into any Knab
server of the same or a newer version. Importing your own export gives you a
copy to experiment with.

### How is this different from the CSV export?

The CSV is a list of transactions for spreadsheets. It cannot be imported and
leaves out assigned amounts, category order and recurring transactions.

### How does the whole server get backed up?

Separately, by whoever runs the server: `node scripts/backup.js` copies the
entire database (all users and budgets) to the `backups` folder. The README
explains that and how to restore it.

## Appearance and devices

### How do I switch to dark mode?

Settings, in the "Signed in as" section: Appearance can be Match device, Light or Dark. It is remembered per
browser.

### Does Knab work on a phone?

Yes. Every screen is designed for a phone first and widens on a computer. On a
phone the navigation is a bar at the bottom with the + button in the middle.

### Which settings are per device and which are shared?

Remembered in the browser only: dark mode, column widths, collapsed groups and
the last account used. Shared with everyone on the budget: categories and their
order, flags, accounts, transactions and assigned amounts.

## Automation: API, command line and AI assistants

### How do I add transactions from a script or another program?

Create an API token under Settings > API tokens, then POST to
`/api/v1/transactions`. A token works for one budget. API.md has the fields,
the JSON Schema and examples; the same page is linked from Settings.

### Is there a command-line tool?

Yes: `knab add`, `knab transfer`, `knab accounts`, `knab categories`,
`knab budget` and `knab recent`. It reads `KNAB_URL` and `KNAB_TOKEN`, or
`~/.config/knab/config.json`.

### How do I let Claude use my budget?

Run the MCP server (`knab mcp`) from Claude Code or Claude Desktop with an API
token. MCP.md has the steps. Claude can then list accounts, categories and
flags, read the budget and reports, add and update transactions, add transfers
and assign money. It cannot delete anything or change accounts, categories,
users or settings. Setting `KNAB_MCP_READONLY=1` makes it look-only.

### What can I ask an assistant that has both this manual and the MCP tools?

How-to questions are answered from this manual ("how do I move a category?").
Questions about your own money are answered with the tools ("how much is left
in Groceries?", "what did we spend on dining out the last three periods?").
Requests to act use the write tools ("add 450 at the cafe from Checking under
Dining Out").

### How do I revoke a token?

Settings > API tokens > Revoke. Anything using it stops working at once.

## Troubleshooting

### Why did my expense get rejected?

An expense needs a category, and account, category and flag names must match
existing ones (capital letters do not matter). The error message lists the
valid names.

### Why does a category show money I did not assign this period?

Available includes what was left over, or overspent, in earlier periods.

### Why did the numbers per period change after I changed the start day?

Transactions were re-sorted into the new date ranges. See "What happens to my
history when I change it?".

### Why can I not delete a category, group or account?

A category with transactions can only be hidden. A group must be empty first.
Close an account rather than deleting it if it has history.

### Why is a recurring transaction missing?

Check Scheduled: it may have been skipped, or have passed its Until date. The
server must be running for entries to be made; anything missed is entered the
next time it starts.

## Glossary

- **Activity**: a category's transactions in one period.
- **Assigned**: money put into a category in one period.
- **Available**: a category's running balance.
- **Cleared**: a transaction the bank has processed.
- **Cutoff day / period start day**: the day of the month a budget period begins.
- **Flag**: a coloured label on a transaction.
- **Group**: a heading that holds related categories.
- **Period**: one budget "month", named `YYYY-MM` after the month it starts in.
- **Ready to Assign**: money not yet in any category.
- **Working balance**: cleared plus uncleared.
