const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

router.get('/', async (req, res) => {
  const { level, stream } = req.query;
  let query = 'SELECT * FROM courses WHERE is_published=1';
  const params = [];
  if (level) { query += ' AND level=?'; params.push(level); }
  if (stream) { query += ' AND (stream=? OR stream="all")'; params.push(stream); }
  query += ' ORDER BY enrolled_count DESC';
  const [courses] = await db.query(query, params);
  res.render('courses/index', { pageTitle: 'Courses', courses, filters: req.query });
});

router.get('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM courses WHERE id=? AND is_published=1', [req.params.id]);
  if (!rows.length) return res.redirect('/courses');
  let purchased = false;
  if (req.session.user) {
    const [p] = await db.query('SELECT * FROM course_purchases WHERE user_id=? AND course_id=? AND status="completed"', [req.session.user.id, req.params.id]);
    purchased = p.length > 0;
  }
  res.render('courses/detail', { pageTitle: rows[0].title, course: rows[0], purchased });
});

router.post('/purchase', isAuthenticated, async (req, res) => {
  const { course_id, payment_method, transaction_id } = req.body;
  const [courses] = await db.query('SELECT * FROM courses WHERE id=?', [course_id]);
  if (!courses.length) { req.flash('error', 'Course not found'); return res.redirect('/courses'); }
  const course = courses[0];
  if (course.price == 0) {
    await db.query('INSERT IGNORE INTO course_purchases (user_id, course_id, amount, status) VALUES (?,?,0,"completed")', [req.session.user.id, course_id]);
    req.flash('success', 'You are now enrolled!');
    return res.redirect('/student');
  }
  await db.query('INSERT INTO course_purchases (user_id, course_id, amount, payment_method, transaction_id, status) VALUES (?,?,?,?,?,"pending")',
    [req.session.user.id, course_id, course.price, payment_method, transaction_id]);
  await db.query('UPDATE courses SET enrolled_count=enrolled_count+1 WHERE id=?', [course_id]);
  req.flash('info', 'Purchase submitted! Admin will verify and activate within 24 hours.');
  res.redirect('/student');
});

router.get('/:id/enroll', isAuthenticated, async (req, res) => {
  const [courses] = await db.query('SELECT * FROM courses WHERE id=? AND price=0', [req.params.id]);
  if (!courses.length) return res.redirect('/courses');
  await db.query('INSERT IGNORE INTO course_purchases (user_id, course_id, amount, status) VALUES (?,?,0,"completed")', [req.session.user.id, req.params.id]);
  req.flash('success', 'Enrolled successfully!');
  res.redirect('/student');
});

module.exports = router;
