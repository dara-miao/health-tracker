-- Allow more than one workout a day (the grid shades darker for 2+).
CREATE TABLE workouts_new (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,                   -- game day, YYYY-MM-DD
  kind TEXT NOT NULL CHECK (kind IN ('gym', 'sport', 'run')),
  note TEXT,                           -- e.g. "legs", "tennis"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO workouts_new (id, player_id, day, kind, note, created_at) SELECT id, player_id, day, kind, note, created_at FROM workouts;
DROP TABLE workouts;
ALTER TABLE workouts_new RENAME TO workouts;
CREATE INDEX workouts_player_day ON workouts (player_id, day);
