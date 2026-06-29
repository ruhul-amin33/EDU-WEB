-- =========================================
-- MIGRATION: Add Year and Board/University fields to questions
-- Safe to run multiple times.
-- =========================================

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'questions' AND COLUMN_NAME = 'exam_year'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE questions ADD COLUMN exam_year VARCHAR(10) DEFAULT NULL AFTER chapter, ADD COLUMN board VARCHAR(100) DEFAULT NULL AFTER exam_year',
  'SELECT "exam_year/board already exist"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration complete! Year and Board/University fields added to questions table.' AS status;
