-- Coloured flags: a per-budget list, and at most one flag per transaction.
CREATE TABLE flags (
  id INTEGER PRIMARY KEY,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (budget_id, name)
);

ALTER TABLE transactions ADD COLUMN flag_id INTEGER REFERENCES flags(id) ON DELETE SET NULL;
CREATE INDEX idx_transactions_flag ON transactions(flag_id) WHERE flag_id IS NOT NULL;

-- Existing budgets get the same starter set as new ones.
INSERT INTO flags (budget_id, name, color, sort)
SELECT b.id, d.name, d.color, d.sort FROM budgets b CROSS JOIN (
  SELECT 'Red' AS name, 'red' AS color, 0 AS sort UNION ALL
  SELECT 'Orange', 'orange', 1 UNION ALL
  SELECT 'Yellow', 'yellow', 2 UNION ALL
  SELECT 'Green', 'green', 3 UNION ALL
  SELECT 'Blue', 'blue', 4 UNION ALL
  SELECT 'Purple', 'purple', 5
) d;
