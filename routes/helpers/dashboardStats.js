/* =========================================================
   dashboard-stats-helpers.js
   Save as: routes/helpers/dashboardStats.js

   Assumes config/db.js exports a mysql2 promise pool, e.g.:
     const mysql = require('mysql2/promise');
     module.exports = mysql.createPool({ ... });
   If your db.js exports differently, adjust the `pool.query`
   calls below to match (e.g. pool.execute, or a callback style).
   ========================================================= */

const pool = require('../../config/db');

/** Turn raw seconds into "31s" / "5m 12s" / "1h 4m" like the UI shows */
function formatStudyTime(totalSeconds) {
  const s = Number(totalSeconds) || 0;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Sum study_sessions.seconds for the last N days (inclusive of today) */
async function getStudyTimeSeconds(userId, days = 7) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(seconds), 0) AS total
     FROM study_sessions
     WHERE user_id = ? AND study_date >= (CURDATE() - INTERVAL ? DAY)`,
    [userId, days - 1]
  );
  return rows[0].total;
}

/** Accuracy % over the last N days, based on completed exam answers */
async function getAccuracy(userId, days = 7) {
  const [rows] = await pool.query(
    `SELECT
       SUM(ea.is_correct) AS correct,
       COUNT(*) AS total
     FROM exam_answers ea
     JOIN exams e ON e.id = ea.exam_id
     WHERE e.user_id = ?
       AND e.completed_at IS NOT NULL
       AND e.completed_at >= (CURDATE() - INTERVAL ? DAY)`,
    [userId, days - 1]
  );
  const { correct, total } = rows[0];
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/**
 * Call this once whenever a user is "active" (e.g. dashboard load,
 * or every N seconds via a small heartbeat from the client).
 * - Logs study seconds for today
 * - Updates current/longest streak
 */
async function logActivityAndStreak(userId, secondsToAdd = 0) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (secondsToAdd > 0) {
      await conn.query(
        `INSERT INTO study_sessions (user_id, study_date, seconds)
         VALUES (?, CURDATE(), ?)
         ON DUPLICATE KEY UPDATE seconds = seconds + VALUES(seconds)`,
        [userId, secondsToAdd]
      );
    }

    const [[user]] = await conn.query(
      `SELECT current_streak, longest_streak, last_active_date FROM users WHERE id = ?`,
      [userId]
    );

    let { current_streak, longest_streak, last_active_date } = user;
    const today = new Date().toISOString().slice(0, 10);

    if (last_active_date) {
      const last = new Date(last_active_date).toISOString().slice(0, 10);
      const diffDays = Math.round(
        (new Date(today) - new Date(last)) / 86400000
      );
      if (diffDays === 0) {
        // already counted today, no change
      } else if (diffDays === 1) {
        current_streak += 1;
      } else {
        current_streak = 1;
      }
    } else {
      current_streak = 1;
    }

    longest_streak = Math.max(longest_streak, current_streak);

    await conn.query(
      `UPDATE users SET current_streak = ?, longest_streak = ?, last_active_date = CURDATE() WHERE id = ?`,
      [current_streak, longest_streak, userId]
    );

    await conn.commit();
    return current_streak;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Award XP, e.g. after finishing practice/exam questions */
async function addXp(userId, amount) {
  await pool.query(`UPDATE users SET xp = xp + ? WHERE id = ?`, [amount, userId]);
}

module.exports = {
  formatStudyTime,
  getStudyTimeSeconds,
  getAccuracy,
  logActivityAndStreak,
  addXp,
};


/* =========================================================
   EXAMPLE — wire this into routes/student.js

   const {
     formatStudyTime,
     getStudyTimeSeconds,
     getAccuracy,
     logActivityAndStreak,
   } = require('./helpers/dashboardStats');

   router.get('/dashboard', isAuthenticated, async (req, res) => {
     const userId = req.session.user.id;
     const range = parseInt(req.query.range) || 7; // 7 / 15 / 30 from the tab buttons

     // counts today's visit toward the streak (no extra seconds yet)
     const streak = await logActivityAndStreak(userId, 0);

     const [studySeconds, accuracyPercent] = await Promise.all([
       getStudyTimeSeconds(userId, range),
       getAccuracy(userId, range),
     ]);

     const [[userRow]] = await pool.query('SELECT xp FROM users WHERE id = ?', [userId]);

     res.render('student/dashboard', {
       xp: userRow.xp,
       streak,
       studyTimeLabel: formatStudyTime(studySeconds),
       accuracyPercent,
       range,
     });
   });

   // Optional: small heartbeat endpoint the frontend can ping every
   // 30s while a user is on a practice/exam page, to log real study time.
   router.post('/dashboard/heartbeat', isAuthenticated, async (req, res) => {
     await logActivityAndStreak(req.session.user.id, 30);
     res.sendStatus(204);
   });
   ========================================================= */
