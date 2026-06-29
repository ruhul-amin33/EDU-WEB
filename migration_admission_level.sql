-- =========================================
-- MIGRATION: Allow 'admission' as a valid level
-- for questions, exam_templates, and exams tables.
-- Safe to run multiple times.
-- =========================================

ALTER TABLE questions MODIFY level ENUM('ssc','hsc','admission') NOT NULL;
ALTER TABLE exam_templates MODIFY level ENUM('ssc','hsc','admission') NOT NULL;
ALTER TABLE exams MODIFY level ENUM('ssc','hsc','admission') NOT NULL;

SELECT 'Migration complete! Admission level is now allowed in questions, exam_templates, and exams.' AS status;
