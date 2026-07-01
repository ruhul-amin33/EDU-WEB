-- =========================================
-- PARAFIN EDUCATION PLATFORM - DATABASE SCHEMA
--
-- LOCAL / SELF-HOSTED MYSQL: run this file as-is — it creates the
-- "parafin_db" database for you.
--
-- FREE-TIER HOSTS (freedb.tech, etc.): these typically pre-assign you
-- ONE database with a random name (e.g. freedb_xxxxxxxx) and do NOT
-- allow CREATE DATABASE. If you're on a host like that:
--   1. Delete the two lines below (CREATE DATABASE / USE parafin_db)
--   2. Select your assigned database in phpMyAdmin first
--   3. Then import/run the rest of this file
-- =========================================

CREATE DATABASE IF NOT EXISTS parafin_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE parafin_db;

-- Users table (students, teachers, admins)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('student','teacher','admin') DEFAULT 'student',
  stream ENUM('science','arts','commerce') DEFAULT NULL,
  level ENUM('ssc','hsc','admission') DEFAULT NULL,
  hsc_session VARCHAR(20) DEFAULT NULL COMMENT 'HSC batch year for admission candidates, e.g. 2025, 2026',
  avatar VARCHAR(255) DEFAULT NULL,
  is_verified TINYINT(1) DEFAULT 0,
  xp INT NOT NULL DEFAULT 0 COMMENT 'Gamification points, shown on the student dashboard',
  current_streak INT NOT NULL DEFAULT 0 COMMENT 'Consecutive days of activity',
  longest_streak INT NOT NULL DEFAULT 0,
  last_active_date DATE DEFAULT NULL COMMENT 'Last calendar day the streak was counted',
  reset_token VARCHAR(255) DEFAULT NULL,
  reset_expires DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily study-time tracking (powers the "Study Time" stat on the student dashboard)
CREATE TABLE IF NOT EXISTS study_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  study_date DATE NOT NULL,
  seconds INT NOT NULL DEFAULT 0,
  UNIQUE KEY user_date (user_id, study_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- PDF categories
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  name_bn VARCHAR(100) NOT NULL,
  level ENUM('ssc','hsc','other') NULL DEFAULT NULL,
  stream ENUM('science','arts','commerce','all') NULL DEFAULT NULL,
  parent_id INT DEFAULT NULL,
  icon VARCHAR(50) DEFAULT '📁',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- PDF study materials
CREATE TABLE IF NOT EXISTS study_materials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_bn VARCHAR(255) NOT NULL,
  description TEXT,
  category_id INT NOT NULL,
  year VARCHAR(10) DEFAULT NULL,
  subject VARCHAR(100) DEFAULT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size VARCHAR(20) DEFAULT NULL,
  download_count INT DEFAULT 0,
  uploaded_by INT NOT NULL,
  is_approved TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_bn VARCHAR(255) NOT NULL,
  description TEXT,
  description_bn TEXT,
  price DECIMAL(10,2) DEFAULT 0,
  original_price DECIMAL(10,2) DEFAULT 0,
  level ENUM('ssc','hsc','other') NOT NULL,
  stream ENUM('science','arts','commerce','all') DEFAULT 'all',
  session VARCHAR(20) DEFAULT NULL COMMENT 'academic year, e.g. 2025, 2026, 2027',
  board VARCHAR(50) DEFAULT NULL COMMENT 'education board, e.g. Dhaka, Rajshahi, Chittagong',
  is_admission TINYINT(1) DEFAULT 0 COMMENT 'flags this as an admission-prep course (shown on /admission)',
  thumbnail VARCHAR(255) DEFAULT NULL,
  instructor VARCHAR(100) DEFAULT NULL,
  duration VARCHAR(50) DEFAULT NULL,
  total_lessons INT DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0,
  enrolled_count INT DEFAULT 0,
  is_published TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Course purchases
CREATE TABLE IF NOT EXISTS course_purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  course_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'bkash',
  transaction_id VARCHAR(100) DEFAULT NULL,
  status ENUM('pending','completed','failed') DEFAULT 'pending',
  purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Questions bank
CREATE TABLE IF NOT EXISTS questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_text TEXT NOT NULL,
  question_text_bn TEXT,
  option_a VARCHAR(500) NOT NULL,
  option_b VARCHAR(500) NOT NULL,
  option_c VARCHAR(500) NOT NULL,
  option_d VARCHAR(500) NOT NULL,
  correct_answer ENUM('a','b','c','d') NOT NULL,
  explanation TEXT,
  explanation_bn TEXT,
  subject VARCHAR(100) NOT NULL,
  chapter VARCHAR(100) DEFAULT NULL,
  level ENUM('ssc','hsc','admission') NOT NULL,
  stream ENUM('science','arts','commerce','all') DEFAULT 'all',
  difficulty ENUM('easy','medium','hard') DEFAULT 'medium',
  created_by INT NOT NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  admin_comment TEXT DEFAULT NULL,
  teacher_fixed TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Exam templates — created by teachers/admins, students browse & take these
CREATE TABLE IF NOT EXISTS exam_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  level ENUM('ssc','hsc','admission') NOT NULL,
  stream ENUM('science','arts','commerce','all') DEFAULT 'all',
  subject VARCHAR(100) DEFAULT NULL,
  chapter VARCHAR(100) DEFAULT NULL,
  question_count INT NOT NULL,
  time_limit INT NOT NULL COMMENT 'in minutes — fully customizable by creator',
  created_by INT NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  attempt_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Exam sessions
CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) DEFAULT NULL,
  level ENUM('ssc','hsc','admission') NOT NULL,
  stream ENUM('science','arts','commerce','all') DEFAULT 'all',
  subject VARCHAR(100) DEFAULT NULL,
  question_count INT NOT NULL,
  time_limit INT NOT NULL COMMENT 'in minutes',
  exam_type ENUM('student_custom','teacher_set') DEFAULT 'student_custom',
  teacher_id INT DEFAULT NULL,
  template_id INT DEFAULT NULL,
  score INT DEFAULT NULL,
  total_questions INT DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (teacher_id) REFERENCES users(id),
  FOREIGN KEY (template_id) REFERENCES exam_templates(id) ON DELETE SET NULL
);

-- Exam answers
CREATE TABLE IF NOT EXISTS exam_answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  question_id INT NOT NULL,
  selected_answer ENUM('a','b','c','d') DEFAULT NULL,
  is_correct TINYINT(1) DEFAULT 0,
  report_text TEXT DEFAULT NULL,
  report_status ENUM('none','reported','resolved') DEFAULT 'none',
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- Question reports/comments
CREATE TABLE IF NOT EXISTS question_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT NOT NULL,
  reported_by INT NOT NULL,
  report_type ENUM('wrong_answer','typo','unclear','other') NOT NULL,
  comment TEXT NOT NULL,
  status ENUM('open','admin_reviewed','fixed') DEFAULT 'open',
  admin_comment TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id)
);

-- Student reviews
CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  display_name VARCHAR(100) DEFAULT NULL COMMENT 'used when admin creates a review not tied to a real user',
  display_role VARCHAR(100) DEFAULT NULL COMMENT 'e.g. "HSC Science" shown under the name',
  rating INT DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL,
  is_approved TINYINT(1) DEFAULT 0,
  created_by_admin TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  name_bn VARCHAR(100) NOT NULL,
  role VARCHAR(100) NOT NULL,
  role_bn VARCHAR(100) NOT NULL,
  description TEXT,
  description_bn TEXT,
  photo VARCHAR(255) DEFAULT NULL,
  facebook VARCHAR(255) DEFAULT NULL,
  telegram VARCHAR(255) DEFAULT NULL,
  youtube VARCHAR(255) DEFAULT NULL,
  whatsapp VARCHAR(50) DEFAULT NULL,
  instagram VARCHAR(255) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1
);

-- Site settings
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =========================================
-- SEED DATA
-- =========================================

-- Admin user (password: admin123)
INSERT INTO users (name, email, password, role, is_verified) VALUES
('Admin', 'admin@parafin.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 1),
('Teacher Demo', 'teacher@parafin.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'teacher', 1);

-- Categories (free-form folders — admin can rename/restructure anything via Material Manager)
INSERT INTO categories (name, name_bn, icon, sort_order) VALUES
('SSC Question Bank', 'এসএসসি প্রশ্নব্যাংক', '📚', 1),
('HSC Question Bank', 'এইচএসসি প্রশ্নব্যাংক', '📖', 2),
('SSC Books', 'এসএসসি বই', '📕', 3),
('HSC Books', 'এইচএসসি বই', '📗', 4);

-- Example sub-folders inside SSC Question Bank (id=1) and HSC Question Bank (id=2)
INSERT INTO categories (name, name_bn, parent_id, icon, sort_order) VALUES
('Science', 'বিজ্ঞান বিভাগ', 1, '🔬', 1),
('Arts', 'মানবিক বিভাগ', 1, '🎨', 2),
('Commerce', 'বাণিজ্য বিভাগ', 1, '💼', 3),
('Science', 'বিজ্ঞান বিভাগ', 2, '⚗️', 1),
('Arts', 'মানবিক বিভাগ', 2, '📜', 2),
('Commerce', 'বাণিজ্য বিভাগ', 2, '📊', 3);

-- Team members
INSERT INTO team_members (name, name_bn, role, role_bn, description, description_bn, sort_order) VALUES
('Rafiul Islam', 'রাফিউল ইসলাম', 'Founder & CEO', 'প্রতিষ্ঠাতা ও সিইও', 'Passionate educator with 8+ years of experience in teaching HSC and SSC students across Bangladesh.', '৮+ বছরের অভিজ্ঞতাসম্পন্ন শিক্ষক। বাংলাদেশের হাজারো শিক্ষার্থীর স্বপ্নপূরণে নিবেদিত।', 1),
('Nusrat Jahan', 'নুসরাত জাহান', 'Head of Content', 'কন্টেন্ট বিভাগের প্রধান', 'Expert in curriculum design with specialization in Science subjects for HSC level.', 'বিজ্ঞান বিষয়ে বিশেষজ্ঞ। পাঠ্যক্রম তৈরিতে দক্ষ ও অভিজ্ঞ।', 2),
('Tanvir Ahmed', 'তানভীর আহমেদ', 'Lead Developer', 'প্রধান ডেভেলপার', 'Full-stack developer building the Parafin platform to empower students across Bangladesh.', 'ফুল-স্ট্যাক ডেভেলপার। পারাফিন প্ল্যাটফর্মকে আরও উন্নত করে যাচ্ছেন।', 3),
('Sadia Akter', 'সাদিয়া আক্তার', 'Mathematics Expert', 'গণিত বিশেষজ্ঞ', 'Gold medalist in Mathematics with expertise in making complex topics simple and accessible.', 'গণিতে স্বর্ণপদকজয়ী। জটিল বিষয়কে সহজে বোধগম্য করতে পারদর্শী।', 4);

-- Reviews
INSERT INTO reviews (user_id, rating, review_text, is_approved) VALUES
(1, 5, 'Parafin has completely changed how I study! The exam practice system is amazing. I improved my grades significantly.', 1),
(2, 5, 'Best educational platform in Bangladesh! The PDF materials are very helpful and the teachers are excellent.', 1);

-- Settings (all admin-editable site content lives here)
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

-- =========================================
-- SITE APPEARANCE (admin switchable color theme + font size)
-- =========================================
INSERT INTO settings (setting_key, setting_value) VALUES ('site_theme', 'default')
  ON DUPLICATE KEY UPDATE setting_value = setting_value;
INSERT INTO settings (setting_key, setting_value) VALUES ('site_font_size', 'standard')
  ON DUPLICATE KEY UPDATE setting_value = setting_value;
