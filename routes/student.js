const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// Setup stream/level
router.get('/setup', isAuthenticated, (req, res) => res.render('student/setup', { pageTitle: 'Setup Profile' }));

router.post('/setup', isAuthenticated, async (req, res) => {
  const { stream, level, hsc_session } = req.body;
  await db.query(
    'UPDATE users SET stream=?, level=?, hsc_session=? WHERE id=?',
    [stream, level, hsc_session || null, req.session.user.id]
  );
  req.session.user.stream = stream;
  req.session.user.level = level;
  req.session.user.hsc_session = hsc_session || null;
  req.flash('success', 'Profile setup complete!');
  res.redirect('/student');
});

// Dashboard
router.get('/', isAuthenticated, async (req, res) => {
  const uid = req.session.user.id;
  const [[examCount]] = await db.query('SELECT COUNT(*) as c FROM exams WHERE user_id=?', [uid]);
  const [[avgScore]] = await db.query('SELECT AVG(score/total_questions*100) as avg FROM exams WHERE user_id=? AND score IS NOT NULL', [uid]);
  const [recentExams] = await db.query('SELECT * FROM exams WHERE user_id=? ORDER BY created_at DESC LIMIT 5', [uid]);
  const [purchases] = await db.query('SELECT c.title, c.title_bn, cp.status, cp.purchased_at FROM course_purchases cp JOIN courses c ON c.id=cp.course_id WHERE cp.user_id=?', [uid]);
  res.render('student/dashboard', { pageTitle: 'Dashboard', examCount: examCount.c, avgScore: Math.round(avgScore.avg || 0), recentExams, purchases });
});

// Profile
router.get('/profile', isAuthenticated, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id=?', [req.session.user.id]);
  res.render('student/profile', { pageTitle: 'My Profile', profile: rows[0] });
});

router.post('/profile', isAuthenticated, async (req, res) => {
  const { name, stream, level, hsc_session } = req.body;
  await db.query(
    'UPDATE users SET name=?, stream=?, level=?, hsc_session=? WHERE id=?',
    [name, stream, level, hsc_session || null, req.session.user.id]
  );
  req.session.user.name = name; req.session.user.stream = stream; req.session.user.level = level;
  req.session.user.hsc_session = hsc_session || null;
  req.flash('success', 'Profile updated!');
  res.redirect('/student/profile');
});

// Submit review
router.post('/review', isAuthenticated, async (req, res) => {
  const { rating, review_text } = req.body;
  await db.query('INSERT INTO reviews (user_id, rating, review_text) VALUES (?,?,?)', [req.session.user.id, rating, review_text]);
  req.flash('success', 'Review submitted! It will appear after approval.');
  res.redirect('/student');
});

module.exports = router;
