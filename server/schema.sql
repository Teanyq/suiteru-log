-- すいてるログ v2: 匿名の号車混雑報告（docs/SPEC-v2.md）
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,        -- アプリが作るランダム ID（個人情報ではない）
  line TEXT NOT NULL,          -- 「会社|路線」（国土数値情報の正式名称）
  dir TEXT NOT NULL,           -- 方面（終点の駅名）
  daytype TEXT NOT NULL,       -- 'wd' 平日 / 'we' 休日
  slot INTEGER NOT NULL,       -- 15 分枠（0〜95）
  car INTEGER NOT NULL,        -- 号車（1〜20）
  level INTEGER NOT NULL,      -- 混雑度（1〜5）
  mood TEXT,                   -- 任意の気分スタンプ（sleepy/fight/tired/happy）。号車のあだ名に使う
  created_at INTEGER NOT NULL  -- 受け付けた時刻（Unix ms）
);
CREATE INDEX IF NOT EXISTS reports_lookup ON reports (line, dir, daytype, slot, created_at);
CREATE INDEX IF NOT EXISTS reports_device ON reports (device, created_at);
