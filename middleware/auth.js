const db = require('../config/db');

// =========================================
// UNIFIED SITE SETTINGS CACHE
// All admin-editable content (hero text, social links, contact info,
// theme, font size) is cached here to avoid a DB hit on every request.
// =========================================

const DEFAULT_SETTINGS = {
  site_name: 'Parafin',
  hero_badge_en: "🇧🇩 Bangladesh's #1 Education Platform",
  hero_badge_bn: '🇧🇩 বাংলাদেশের #১ শিক্ষামূলক প্ল্যাটফর্ম',
  hero_title_en: 'Your Path to Academic Excellence',
  hero_title_bn: 'পরীক্ষায় সেরা ফলাফল অর্জনের পথ',
  hero_subtitle_en: 'Complete SSC & HSC exam preparation — question banks, PDF books, live practice exams, and expert teacher guidance.',
  hero_subtitle_bn: 'SSC ও HSC পরীক্ষার সম্পূর্ণ প্রস্তুতি নিন — প্রশ্নব্যাংক, PDF বই, লাইভ পরীক্ষা এবং বিশেষজ্ঞ শিক্ষকের গাইডেন্স।',
  stat_students: '50K+',
  stat_questions: '5K+',
  stat_pdfs: '200+',
  stat_satisfaction: '98%',
  footer_about_en: "Parafin — Your trusted partner in academic excellence.",
  footer_about_bn: 'পারাফিন — বাংলাদেশের শিক্ষার্থীদের স্বপ্নপূরণের সঙ্গী।',
  facebook_url: '',
  telegram_url: '',
  youtube_url: '',
  whatsapp_number: '',
  support_email: '',
  support_phone: '',
  footer_copyright_en: 'All rights reserved.',
  footer_copyright_bn: 'সর্বস্বত্ব সংরক্ষিত।',
  footer_tagline_en: 'Made with ❤️ in Bangladesh',
  footer_tagline_bn: 'ভালোবাসা দিয়ে তৈরি ❤️ বাংলাদেশে',
  site_theme: 'default',
  site_font_size: 'standard',
  hero_spacing: 'normal',
  site_logo: '/images/logo.png',
  deco_style: 'modern',
  layout_style: 'classic',
  site_font_family: 'inter',
};

let cachedSettings = { ...DEFAULT_SETTINGS };

exports.refreshSettings = async () => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM settings');
    const fromDb = {};
    rows.forEach(r => { fromDb[r.setting_key] = r.setting_value; });
    cachedSettings = { ...DEFAULT_SETTINGS, ...fromDb };
  } catch (e) {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
};

exports.getSettings = () => cachedSettings;

// Backwards-compatible helpers (used by existing admin/appearance routes)
exports.refreshSiteTheme = async () => {
  await exports.refreshSettings();
  return cachedSettings.site_theme;
};
exports.refreshFontSize = async () => {
  await exports.refreshSettings();
  return cachedSettings.site_font_size;
};

exports.isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please login to continue');
  res.redirect('/auth/login');
};

exports.isAdmin = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).render('error', { title: 'Access Denied', message: 'Admin access required', user: req.session.user });
};

exports.isTeacher = (req, res, next) => {
  if (req.session && req.session.user && ['teacher', 'admin'].includes(req.session.user.role)) return next();
  res.status(403).render('error', { title: 'Access Denied', message: 'Teacher access required', user: req.session.user });
};

exports.isStudent = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'student') return next();
  res.redirect('/auth/login');
};

exports.setLocals = (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.lang = req.session.lang || 'en';
  res.locals.theme = req.session.theme || 'light';
  res.locals.siteTheme = cachedSettings.site_theme;
  res.locals.siteFontSize = cachedSettings.site_font_size;
  res.locals.settings = cachedSettings; // full editable content object, available in every view
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
    info: req.flash('info')
  };
  next();
};
