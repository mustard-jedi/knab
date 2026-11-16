-- Recurring schedules become "planned items": they can wait for the user
-- instead of entering themselves, run for a fixed number of payments
-- (installments, or a single one-off), and be marked as a debt already owed.
ALTER TABLE recurring ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE recurring ADD COLUMN auto INTEGER NOT NULL DEFAULT 1;      -- 1 = enters itself on its date
ALTER TABLE recurring ADD COLUMN total_count INTEGER;                  -- payments in all; NULL = open-ended
ALTER TABLE recurring ADD COLUMN remaining INTEGER;                    -- payments still to go; NULL = open-ended
ALTER TABLE recurring ADD COLUMN is_debt INTEGER NOT NULL DEFAULT 0;
