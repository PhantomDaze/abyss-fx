-- 每日挑战全球排行榜
CREATE TABLE IF NOT EXISTS scores (
  day_key    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  equity     REAL    NOT NULL,
  dd         REAL    NOT NULL,
  trades     INTEGER NOT NULL,
  hits       INTEGER NOT NULL,
  mod_id     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day_key, player_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_day_score ON scores(day_key, score DESC);
