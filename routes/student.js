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

// Helper: format seconds into a short label like "31s", "5m 20s", "1h 5m"
function formatStudyTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Helper: bump the user's daily streak based on last_active_date (call once per dashboard load)
async function refreshStreak(uid) {
  const [[row]] = await db.query('SELECT current_streak, longest_streak, last_active_date FROM users WHERE id=?', [uid]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = row.last_active_date ? new Date(row.last_active_date) : null;
  if (last) last.setHours(0, 0, 0, 0);

  let streak = row.current_streak || 0;
  if (!last) {
    streak = 0; // brand new user, streak starts once they actually practice
  } else if (last.getTime() !== today.getTime()) {
    const diffDays = Math.round((today - last) / 86400000);
    if (diffDays === 1) streak += 1;       // consecutive day
    else if (diffDays > 1) streak = 0;     // streak broken
    const longest = Math.max(streak, row.longest_streak || 0);
    await db.query('UPDATE users SET current_streak=?, longest_streak=?, last_active_date=? WHERE id=?', [streak, longest, today.toISOString().slice(0, 10), uid]);
  }
  return streak;
}

// Dashboard
router.get('/', isAuthenticated, async (req, res) => {
  const uid = req.session.user.id;
  const [[examCount]] = await db.query('SELECT COUNT(*) as c FROM exams WHERE user_id=?', [uid]);
  const [[avgScore]] = await db.query('SELECT AVG(score/total_questions*100) as avg FROM exams WHERE user_id=? AND score IS NOT NULL', [uid]);
  const [recentExams] = await db.query('SELECT * FROM exams WHERE user_id=? ORDER BY created_at DESC LIMIT 5', [uid]);
  const [purchases] = await db.query('SELECT c.title, c.title_bn, cp.status, cp.purchased_at FROM course_purchases cp JOIN courses c ON c.id=cp.course_id WHERE cp.user_id=?', [uid]);
  const [[userRow]] = await db.query('SELECT xp, avatar FROM users WHERE id=?', [uid]);
  const [[todayStudy]] = await db.query('SELECT COALESCE(SUM(seconds),0) as total FROM study_sessions WHERE user_id=? AND study_date=CURDATE()', [uid]);

  const streak = await refreshStreak(uid);
  const accuracyPercent = Math.round(avgScore.avg || 0);

  res.render('student/dashboard', {
    pageTitle: 'Dashboard',
    examCount: examCount.c,
    avgScore: accuracyPercent,
    accuracyPercent,
    recentExams,
    purchases,
    xp: userRow.xp || 0,
    streak,
    studyTimeLabel: formatStudyTime(todayStudy.total),
    avatarUrl: userRow.avatar ? (userRow.avatar.startsWith('http') ? userRow.avatar : '/uploads/avatars/' + userRow.avatar) : null,
    notifications: [
      req.session.lang === 'bn' ? 'আপনার একাউন্টে নতুন লগইন' : 'New Login to Your Account'
    ]
  });
});

// Track study time (called periodically from the dashboard while the tab is active)
router.post('/track-time', isAuthenticated, async (req, res) => {
  const uid = req.session.user.id;
  const seconds = Math.min(60, Math.max(0, parseInt(req.body.seconds, 10) || 0)); // clamp to avoid abuse
  await db.query(
    `INSERT INTO study_sessions (user_id, study_date, seconds) VALUES (?, CURDATE(), ?)
     ON DUPLICATE KEY UPDATE seconds = seconds + VALUES(seconds)`,
    [uid, seconds]
  );
  res.json({ ok: true });
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
