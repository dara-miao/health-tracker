-- Iron: estimated per item, like fiber. Not one of the four daily goals.
ALTER TABLE food_entries ADD COLUMN iron_mg REAL;     -- null = not estimated (logged before this existed)
ALTER TABLE players ADD COLUMN iron_target INTEGER;   -- daily aim in mg; null = none set

-- Water: a log of drinks, in fluid ounces. Not one of the goals.
CREATE TABLE water_entries (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,                   -- game day, YYYY-MM-DD
  oz REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX water_by_day ON water_entries (player_id, day);
ALTER TABLE players ADD COLUMN water_target INTEGER;  -- daily aim in oz; null = none set
