-- A carb aim: shown on the private page and in the evening check-in, not scored.
ALTER TABLE players ADD COLUMN carb_target INTEGER;
