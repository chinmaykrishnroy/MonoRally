CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  handle VARCHAR(64) UNIQUE NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY,
  code VARCHAR(8) NOT NULL,
  mode VARCHAR(8) NOT NULL,
  winner_team VARCHAR(8),
  total_returns INT NOT NULL DEFAULT 0,
  duration_seconds INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_players (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  name VARCHAR(64) NOT NULL,
  team VARCHAR(8) NOT NULL,
  slot INT NOT NULL,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  returns INT NOT NULL DEFAULT 0,
  misses INT NOT NULL DEFAULT 0,
  rating_before INT,
  rating_after INT
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id UUID PRIMARY KEY,
  mode VARCHAR(8) NOT NULL,
  player_name VARCHAR(64) NOT NULL,
  score INT NOT NULL,
  misses INT NOT NULL,
  duration_seconds INT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rankings
  ON leaderboard_entries (mode, score DESC, misses ASC, duration_seconds ASC);

CREATE INDEX IF NOT EXISTS idx_matches_mode
  ON matches (mode, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_players_match
  ON match_players (match_id);
