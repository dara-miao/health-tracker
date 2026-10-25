-- Players. Each one connects their own agent (e.g. Poke) with their own API key.
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  api_key_hash TEXT NOT NULL UNIQUE,   -- SHA-256 of the key their agent sends as a Bearer token
  private_token TEXT NOT NULL UNIQUE,  -- link to the player's own page (meals, macros, weight)
  color TEXT CHECK (color IN ('pink', 'green')),
  poke_api_key TEXT,                   -- optional: lets the app send them recaps through Poke
  goal_type TEXT CHECK (goal_type IN ('cut', 'bulk')),
  calorie_target INTEGER,
  protein_target INTEGER,
  fat_target INTEGER,                  -- shown and reminded, not scored
  goal_weight_lb REAL,
  pending_bed_at TEXT,                 -- ISO timestamp set by sleep_start
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A meal groups food items. Meals are private to their owner until they choose to share one.
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,                   -- game day, YYYY-MM-DD
  name TEXT,
  shared_at TEXT,                      -- ISO; set when the owner shares it with the other players
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX meals_player_day ON meals (player_id, day);

CREATE TABLE food_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id INTEGER NOT NULL REFERENCES meals(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,
  description TEXT NOT NULL,
  calories INTEGER NOT NULL,
  protein_g INTEGER NOT NULL,
  fat_g INTEGER NOT NULL,
  carbs_g INTEGER NOT NULL
);
CREATE INDEX food_entries_player_day ON food_entries (player_id, day);
CREATE INDEX food_entries_meal ON food_entries (meal_id);

-- One row per night; day is the calendar day you woke up on.
CREATE TABLE sleep_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,
  bed_at TEXT NOT NULL,
  wake_at TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  UNIQUE (player_id, day)
);

-- Private to the player.
CREATE TABLE weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,
  lb REAL NOT NULL,
  UNIQUE (player_id, day)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Dedupe keys for scheduled messages already sent.
CREATE TABLE seen (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
