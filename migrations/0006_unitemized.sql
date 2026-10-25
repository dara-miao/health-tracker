-- A calorie number with no actual foods ("I hit 3000 today"). It's saved and shown, but the day's
-- calorie and protein points aren't awarded until it's replaced with what was eaten.
ALTER TABLE food_entries ADD COLUMN unitemized INTEGER NOT NULL DEFAULT 0;
