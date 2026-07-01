-- =========================================
-- MIGRATION: Gamification (XP, Streak, Study Time)
-- Adds the columns/table that power the Sattacademy-style
-- student dashboard: XP badge, streak card, and study-time stat.
-- Safe to run multiple times.
-- =========================================

-- users.xp
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'xp'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN xp INT NOT NULL DEFAULT 0 AFTER is_verified',
  'SELECT "xp already exists"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.current_streak
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'current_streak'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN current_streak INT NOT NULL DEFAULT 0 AFTER xp',
  'SELECT "current_streak already exists"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.longest_streak
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'longest_streak'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN longest_streak INT NOT NULL DEFAULT 0 AFTER current_streak',
  'SELECT "longest_streak already exists"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.last_active_date
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_active_date'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN last_active_date DATE DEFAULT NULL AFTER longest_streak',
  'SELECT "last_active_date already exists"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- study_sessions table
CREATE TABLE IF NOT EXISTS study_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  study_date DATE NOT NULL,
  seconds INT NOT NULL DEFAULT 0,
  UNIQUE KEY user_date (user_id, study_date),
  KEY user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

SELECT 'Migration complete! xp, streak, and study_sessions are ready — the Sattacademy-style dashboard stats will now work.' AS status;
