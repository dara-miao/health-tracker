-- Sugar, split into added ("refined") and natural. Private, not scored, opt-in per player.
ALTER TABLE food_entries ADD COLUMN sugar_g INTEGER;        -- total sugar; null = not estimated (logged before this existed)
ALTER TABLE food_entries ADD COLUMN added_sugar_g INTEGER;  -- the part that's added sugar; natural = sugar_g - added_sugar_g
ALTER TABLE players ADD COLUMN sugar_target INTEGER;        -- max grams of added sugar a day; null = not tracking
ALTER TABLE players ADD COLUMN sugar_offered INTEGER NOT NULL DEFAULT 0;  -- 1 once their agent has asked if they want sugar tracking
