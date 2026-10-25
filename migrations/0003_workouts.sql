-- Gym consistency: one row per player per day they worked out. Shown to everyone, not scored.
CREATE TABLE workouts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,                   -- game day, YYYY-MM-DD
  kind TEXT NOT NULL CHECK (kind IN ('gym', 'sport', 'run')),
  note TEXT,                           -- e.g. "legs", "tennis"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (player_id, day)
);
ALTER TABLE players ADD COLUMN workout_target INTEGER;  -- workouts per week the streak counts against
