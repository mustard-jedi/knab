-- One flag per budget can be marked as the "review" flag: the one an AI agent
-- puts on a transaction whose category it had to guess.
ALTER TABLE flags ADD COLUMN review INTEGER NOT NULL DEFAULT 0;

INSERT INTO flags (budget_id, name, color, sort)
SELECT b.id, 'To review', 'teal', (SELECT COALESCE(MAX(sort), -1) + 1 FROM flags f WHERE f.budget_id = b.id)
FROM budgets b
WHERE NOT EXISTS (SELECT 1 FROM flags f WHERE f.budget_id = b.id AND f.name = 'To review');

UPDATE flags SET review = 1 WHERE name = 'To review';
