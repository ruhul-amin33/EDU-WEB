const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Bangladesh education boards — standard list used across SSC/HSC admission
const BOARDS = [
  'Dhaka', 'Rajshahi', 'Chittagong', 'Sylhet', 'Barisal',
  'Comilla', 'Dinajpur', 'Jessore', 'Mymensingh',
  'Madrasah', 'Technical (BTEB)'
];

router.get('/', async (req, res) => {
  const { session, board, level, stream } = req.query;

  let query = 'SELECT * FROM courses WHERE is_published=1 AND is_admission=1';
  const params = [];
  if (session) { query += ' AND session=?'; params.push(session); }
  if (board) { query += ' AND board=?'; params.push(board); }
  if (level) { query += ' AND level=?'; params.push(level); }
  if (stream) { query += ' AND (stream=? OR stream="all")'; params.push(stream); }
  query += ' ORDER BY enrolled_count DESC';

  const [courses] = await db.query(query, params);
  const [sessionRows] = await db.query(
    'SELECT DISTINCT session FROM courses WHERE is_admission=1 AND session IS NOT NULL ORDER BY session DESC'
  );

  res.render('admission/index', {
    pageTitle: 'Admission',
    courses,
    sessions: sessionRows.map(r => r.session),
    boards: BOARDS,
    filters: req.query
  });
});

module.exports = router;
