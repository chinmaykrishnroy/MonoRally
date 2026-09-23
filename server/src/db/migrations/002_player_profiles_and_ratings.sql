-- 002_player_profiles_and_ratings.sql
-- Adds persistent profile statistics, Elo ratings, streaks, and skill shot metrics to the players table.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS elo_rating INT NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS peak_rating INT NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS matches_played INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peak_speed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smash_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS curve_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counter_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_players_elo
  ON players (elo_rating DESC, wins DESC, matches_played DESC);
