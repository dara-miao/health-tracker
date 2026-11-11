-- When a meal was eaten, for comparing late eating with sleep. Null = use created_at (when it was logged),
-- which is right for anything logged as it was eaten.
ALTER TABLE meals ADD COLUMN eaten_at TEXT;  -- ISO 8601
