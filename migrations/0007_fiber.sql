-- Fiber: estimated per item, shown with fat and carbs. Not one of the four daily goals.
ALTER TABLE food_entries ADD COLUMN fiber_g INTEGER;  -- null = not estimated (logged before this existed)
ALTER TABLE players ADD COLUMN fiber_target INTEGER;  -- daily aim in grams; null = none set
