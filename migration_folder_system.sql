-- =========================================
-- MIGRATION: Upgrade existing Parafin database
-- Run this ONLY if you already imported the old database.sql
-- and don't want to lose existing data.
-- Safe to run multiple times — every step checks first and skips
-- if already applied.
--
-- IMPORTANT — READ BEFORE RUNNING:
-- This script does NOT select a database for you, because hosts like
-- freedb.tech assign a random database name (e.g. freedb_xxxxxxxx),
-- not "parafin_db". In phpMyAdmin (or your DB tool), click on YOUR
-- actual database name in the sidebar FIRST so it's the active/selected
-- database, THEN run this script. Every statement below uses DATABASE()
-- to detect columns on whichever database is currently selected.
-- =========================================

-- Make level/stream optional (free-form folders no longer require these)
ALTER TABLE categories
  MODIFY level ENUM('ssc','hsc','other') NULL DEFAULT NULL,
  MODIFY stream ENUM('science','arts','commerce','all') NULL DEFAULT NULL;

-- Add sort_order column if it doesn't exist yet
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'sort_order'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE categories ADD COLUMN sort_order INT DEFAULT 0 AFTER icon',
  'SELECT "sort_order already exists"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add session/board/is_admission columns to courses if they don't exist yet (Admission section support)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'session'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE courses ADD COLUMN session VARCHAR(20) DEFAULT NULL AFTER stream, ADD COLUMN board VARCHAR(50) DEFAULT NULL AFTER session, ADD COLUMN is_admission TINYINT(1) DEFAULT 0 AFTER board',
  'SELECT "session/board/is_admission already exist"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add exam_templates table if it doesn't exist (Set Exam feature)
CREATE TABLE IF NOT EXISTS exam_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  level ENUM('ssc','hsc') NOT NULL,
  stream ENUM('science','arts','commerce','all') DEFAULT 'all',
  subject VARCHAR(100) DEFAULT NULL,
  chapter VARCHAR(100) DEFAULT NULL,
  question_count INT NOT NULL,
  time_limit INT NOT NULL,
  created_by INT NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  attempt_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Add template_id column to exams if it doesn't exist yet
SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exams' AND COLUMN_NAME = 'template_id'
);
SET @sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE exams ADD COLUMN template_id INT DEFAULT NULL AFTER teacher_id, ADD FOREIGN KEY (template_id) REFERENCES exam_templates(id) ON DELETE SET NULL',
  'SELECT "template_id already exists"'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- Make reviews.user_id nullable and add display_name/display_role/created_by_admin if missing
SET @col_exists3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'display_name'
);
SET @sql3 = IF(@col_exists3 = 0,
  'ALTER TABLE reviews MODIFY user_id INT DEFAULT NULL, ADD COLUMN display_name VARCHAR(100) DEFAULT NULL AFTER user_id, ADD COLUMN display_role VARCHAR(100) DEFAULT NULL AFTER display_name, ADD COLUMN created_by_admin TINYINT(1) DEFAULT 0 AFTER is_approved',
  'SELECT "review columns already exist"'
);
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

-- Seed the site_theme setting (admin color theme switcher)
INSERT INTO settings (setting_key, setting_value) VALUES ('site_theme', 'default')
  ON DUPLICATE KEY UPDATE setting_value = setting_value;

-- Seed the site_font_size setting (admin font size switcher)
INSERT INTO settings (setting_key, setting_value) VALUES ('site_font_size', 'standard')
  ON DUPLICATE KEY UPDATE setting_value = setting_value;

-- Seed all editable site content fields (hero text, social links, contact info, footer)
INSERT INTO settings (setting_key, setting_value) VALUES
('site_name', 'Parafin'),
('hero_badge_en', '🇧🇩 Bangladesh''s #1 Education Platform'),
('hero_badge_bn', '🇧🇩 বাংলাদেশের #১ শিক্ষামূলক প্ল্যাটফর্ম'),
('hero_title_en', 'Your Path to **Academic Excellence**'),
('hero_title_bn', 'পরীক্ষায় **সেরা ফলাফল** অর্জনের পথ'),
('hero_subtitle_en', 'Complete SSC & HSC exam preparation — question banks, PDF books, live practice exams, and expert teacher guidance.'),
('hero_subtitle_bn', 'SSC ও HSC পরীক্ষার সম্পূর্ণ প্রস্তুতি নিন — প্রশ্নব্যাংক, PDF বই, লাইভ পরীক্ষা এবং বিশেষজ্ঞ শিক্ষকের গাইডেন্স।'),
('stat_students', '50K+'),
('stat_questions', '5K+'),
('stat_pdfs', '200+'),
('stat_satisfaction', '98%'),
('footer_about_en', 'Parafin — Your trusted partner in academic excellence. We help SSC and HSC students across Bangladesh achieve their dreams.'),
('footer_about_bn', 'পারাফিন — বাংলাদেশের শিক্ষার্থীদের স্বপ্নপূরণের সঙ্গী। SSC ও HSC পরীক্ষায় সেরা ফলাফল অর্জনে আমরা আপনার পাশে আছি।'),
('facebook_url', 'https://facebook.com/parafin'),
('telegram_url', 'https://t.me/Paraffin_01'),
('youtube_url', 'https://www.youtube.com/@Paraffin-প্যারাফিন'),
('whatsapp_number', '8801623961877'),
('support_email', 'support@parafin.com'),
('support_phone', '+880 1623-961877'),
('footer_copyright_en', 'All rights reserved.'),
('footer_copyright_bn', 'সর্বস্বত্ব সংরক্ষিত।'),
('footer_tagline_en', 'Made with ❤️ in Bangladesh'),
('footer_tagline_bn', 'ভালোবাসা দিয়ে তৈরি ❤️ বাংলাদেশে')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

-- Add 'admission' to users.level ENUM and add hsc_session column if missing
SET @col_exists4 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'hsc_session'
);
SET @sql4 = IF(@col_exists4 = 0,
  'ALTER TABLE users MODIFY level ENUM(''ssc'',''hsc'',''admission'') DEFAULT NULL, ADD COLUMN hsc_session VARCHAR(20) DEFAULT NULL AFTER level',
  'SELECT "hsc_session already exists"'
);
PREPARE stmt4 FROM @sql4;
EXECUTE stmt4;
DEALLOCATE PREPARE stmt4;

-- Add telegram/youtube/whatsapp columns to team_members if missing
SET @col_exists5 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_members' AND COLUMN_NAME = 'telegram'
);
SET @sql5 = IF(@col_exists5 = 0,
  'ALTER TABLE team_members ADD COLUMN telegram VARCHAR(255) DEFAULT NULL AFTER facebook, ADD COLUMN youtube VARCHAR(255) DEFAULT NULL AFTER telegram, ADD COLUMN whatsapp VARCHAR(50) DEFAULT NULL AFTER youtube',
  'SELECT "team social columns already exist"'
);
PREPARE stmt5 FROM @sql5;
EXECUTE stmt5;
DEALLOCATE PREPARE stmt5;

SELECT 'Migration complete! Material Manager, Site Content Editor, Appearance Settings, Admin Password Reset, and Excel Export are now ready.' AS status;
