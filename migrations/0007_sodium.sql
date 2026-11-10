-- Sodium: estimated per item, tracked against an optional daily limit. Not one of the four daily goals.
-- Named 0007 to match the row already recorded in d1_migrations: these columns were added by hand in the
-- D1 console, so wrangler treats this file as applied.
ALTER TABLE food_entries ADD COLUMN sodium_mg INTEGER;   -- null = not estimated (logged before this existed)
ALTER TABLE players ADD COLUMN sodium_target INTEGER;    -- max mg of sodium a day; null = not tracking
