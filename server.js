require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARE SETUP
// =============================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(methodOverride('_method'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'parafin_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

app.use(flash());

// Global locals middleware
const { setLocals, refreshSettings } = require('./middleware/auth');
app.use(setLocals);
refreshSettings(); // load all editable site content + appearance settings once at boot

// Create upload dirs if missing
['uploads/pdfs', 'uploads/avatars', 'uploads'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// =============================================
// SETTINGS ROUTES (lang/theme toggle)
// =============================================
app.post('/settings/theme', (req, res) => {
  req.session.theme = req.body.theme || 'light';
  res.json({ ok: true });
});

app.post('/settings/lang', (req, res) => {
  req.session.lang = req.body.lang || 'en';
  res.json({ ok: true });
});

// =============================================
// ROUTES
// =============================================
const db = require('./config/db');

// Home
app.get('/', async (req, res) => {
  try {
    const [courses] = await db.query('SELECT * FROM courses WHERE is_published=1 ORDER BY enrolled_count DESC LIMIT 6');
    const [materialFolders] = await db.query('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY sort_order, name LIMIT 6');
    const [reviews] = await db.query(`
      SELECT r.*,
             COALESCE(u.name, r.display_name) AS name,
             COALESCE(r.display_role, u.stream) AS stream,
             u.level
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.is_approved = 1
      ORDER BY r.created_at DESC
    `);
    const [team] = await db.query('SELECT * FROM team_members WHERE is_active=1 ORDER BY sort_order');
    res.render('home', { pageTitle: 'Home', courses, materialFolders, reviews, team });
  } catch (err) {
    console.error(err);
    res.render('home', { pageTitle: 'Home', courses: [], materialFolders: [], reviews: [], team: [] });
  }
});

// Auth
app.use('/auth', require('./routes/auth'));

// Student
app.use('/student', require('./routes/student'));

// Exam
app.use('/exam', require('./routes/exam'));

// Materials
app.use('/materials', require('./routes/materials'));

// Courses
app.use('/courses', require('./routes/courses'));
app.use('/admission', require('./routes/admission'));

// Admin
app.use('/admin', require('./routes/admin'));

// Teacher
app.use('/teacher', require('./routes/teacher'));

// Support & Contact static pages
app.get('/support', (req, res) => res.render('error', { title: 'Support Center', message: 'For support, email us at support@parafin.com or WhatsApp: +880 1700-000000' }));
app.get('/contact', (req, res) => res.render('error', { title: 'Contact Us', message: 'Email: support@parafin.com | Facebook: facebook.com/parafin' }));
app.get('/privacy', (req, res) => res.render('error', { title: 'Privacy Policy', message: 'Your data is safe with us. We never sell personal information.' }));
app.get('/terms', (req, res) => res.render('error', { title: 'Terms of Service', message: 'By using Parafin, you agree to our terms of academic honesty and respectful conduct.' }));

// =============================================
// 404
// =============================================
app.use((req, res) => {
  res.status(404).render('error', { title: '404 — Page Not Found', message: 'The page you are looking for does not exist.' });
});

// =============================================
// ERROR HANDLER
// =============================================
app.use((err, req, res, next) => {
  // Multer file-too-large errors — show a friendly message and send the user back
  // instead of a generic 500 page.
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    req.flash('error', 'That file is too large. Please upload a smaller file and try again.');
    return res.redirect(req.get('Referrer') || '/');
  }

  console.error('Server Error:', err.stack);
  res.status(500).render('error', { title: '500 — Server Error', message: 'An unexpected error occurred. Please try again.' });
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🎯 PARAFIN Education Platform       ║
  ║   Server running on port ${PORT}          ║
  ║   http://localhost:${PORT}                ║
  ╠═══════════════════════════════════════╣
  ║   Admin: admin@parafin.com            ║
  ║   Pass:  password (change in DB)      ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
