const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

// GET browse/study questions (read-only, no timer, no scoring)
router.get('/browse', isAuthenticated, async (req, res) => {
  const { level, stream, subject, chapter, difficulty, page } = req.query;
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const perPage = 20;
  const offset = (pageNum - 1) * perPage;

  let query = 'SELECT * FROM questions WHERE status="approved"';
  const params = [];
  if (level) { query += ' AND level=?'; params.push(level); }
  if (stream && stream !== 'all') { query += ' AND (stream=? OR stream="all")'; params.push(stream); }
  if (subject) { query += ' AND subject=?'; params.push(subject); }
  if (chapter) { query += ' AND chapter=?'; params.push(chapter); }
  if (difficulty) { query += ' AND difficulty=?'; params.push(difficulty); }

  let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const [[countRow]] = await db.query(countQuery, params);
  const totalQuestions = countRow.total;
  const totalPages = Math.max(Math.ceil(totalQuestions / perPage), 1);

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  const [questions] = await db.query(query, [...params, perPage, offset]);

  const [subjects] = await db.query('SELECT DISTINCT subject FROM questions WHERE status="approved" ORDER BY subject');
  const [chapters] = await db.query(
    'SELECT DISTINCT chapter FROM questions WHERE status="approved" AND chapter IS NOT NULL' + (subject ? ' AND subject=?' : '') + ' ORDER BY chapter',
    subject ? [subject] : []
  );

  res.render('exam/browse', {
    pageTitle: 'Browse Questions',
    questions, subjects, chapters,
    filters: req.query,
    pageNum, totalPages, totalQuestions
  });
});

// GET list of teacher/admin-set exams available to take
router.get('/templates', isAuthenticated, async (req, res) => {
  const { level, stream, subject } = req.query;
  let query = `
    SELECT t.*, u.name AS creator_name
    FROM exam_templates t
    JOIN users u ON u.id = t.created_by
    WHERE t.is_active = 1
  `;
  const params = [];
  if (level) { query += ' AND t.level=?'; params.push(level); }
  if (stream && stream !== 'all') { query += ' AND (t.stream=? OR t.stream="all")'; params.push(stream); }
  if (subject) { query += ' AND t.subject=?'; params.push(subject); }
  query += ' ORDER BY t.created_at DESC';

  const [templates] = await db.query(query, params);
  const [subjects] = await db.query('SELECT DISTINCT subject FROM exam_templates WHERE is_active=1 AND subject IS NOT NULL ORDER BY subject');

  res.render('exam/templates', { pageTitle: 'Teacher-Set Exams', templates, subjects, filters: req.query });
});

// POST start an exam from a teacher/admin-set template
router.post('/templates/:id/start', isAuthenticated, async (req, res) => {
  const [tRows] = await db.query('SELECT * FROM exam_templates WHERE id=? AND is_active=1', [req.params.id]);
  if (!tRows.length) { req.flash('error', 'This exam is no longer available.'); return res.redirect('/exam/templates'); }
  const tpl = tRows[0];
  const uid = req.session.user.id;

  let query = 'SELECT * FROM questions WHERE status="approved" AND level=?';
  const params = [tpl.level];
  if (tpl.stream && tpl.stream !== 'all') { query += ' AND (stream=? OR stream="all")'; params.push(tpl.stream); }
  if (tpl.subject) { query += ' AND subject=?'; params.push(tpl.subject); }
  if (tpl.chapter) { query += ' AND chapter=?'; params.push(tpl.chapter); }
  query += ' ORDER BY RAND() LIMIT ?';
  params.push(tpl.question_count);

  const [questions] = await db.query(query, params);
  if (!questions.length) { req.flash('error', 'No questions currently available for this exam.'); return res.redirect('/exam/templates'); }

  const [result] = await db.query(
    `INSERT INTO exams (user_id, title, level, stream, subject, question_count, time_limit, exam_type, teacher_id, template_id, total_questions)
     VALUES (?,?,?,?,?,?,?,'teacher_set',?,?,?)`,
    [uid, tpl.title, tpl.level, tpl.stream, tpl.subject, tpl.question_count, tpl.time_limit, tpl.created_by, tpl.id, questions.length]
  );
  const examId = result.insertId;
  for (const q of questions) {
    await db.query('INSERT INTO exam_answers (exam_id, question_id) VALUES (?,?)', [examId, q.id]);
  }
  await db.query('UPDATE exam_templates SET attempt_count = attempt_count + 1 WHERE id=?', [tpl.id]);

  res.redirect(`/exam/${examId}`);
});

// GET exam setup
router.get('/setup', isAuthenticated, async (req, res) => {
  const [subjects] = await db.query('SELECT DISTINCT subject FROM questions WHERE status="approved"');
  res.render('exam/setup', { pageTitle: 'Exam Setup', subjects });
});

// POST create exam
router.post('/start', isAuthenticated, async (req, res) => {
  const { level, stream, subject, question_count, time_limit, exam_type } = req.body;
  const uid = req.session.user.id;
  const qCount = Math.min(Math.max(parseInt(question_count) || 10, 1), 200);
  const timeMin = Math.min(Math.max(parseInt(time_limit) || 30, 1), 600);

  let query = 'SELECT * FROM questions WHERE status="approved"';
  const params = [];
  if (level) { query += ' AND level=?'; params.push(level); }
  if (stream && stream !== 'all') { query += ' AND (stream=? OR stream="all")'; params.push(stream); }
  if (subject) { query += ' AND subject=?'; params.push(subject); }
  query += ' ORDER BY RAND() LIMIT ?';
  params.push(qCount);

  const [questions] = await db.query(query, params);
  if (!questions.length) { req.flash('error', 'No questions found for selected criteria.'); return res.redirect('/exam/setup'); }

  const [result] = await db.query(
    'INSERT INTO exams (user_id, level, stream, subject, question_count, time_limit, exam_type, total_questions) VALUES (?,?,?,?,?,?,?,?)',
    [uid, level || 'ssc', stream || 'all', subject || null, qCount, timeMin, exam_type || 'student_custom', questions.length]
  );
  const examId = result.insertId;
  // Pre-insert answer rows
  for (const q of questions) {
    await db.query('INSERT INTO exam_answers (exam_id, question_id) VALUES (?,?)', [examId, q.id]);
  }
  res.redirect(`/exam/${examId}`);
});

// GET take exam
router.get('/:id', isAuthenticated, async (req, res) => {
  const [exams] = await db.query('SELECT * FROM exams WHERE id=? AND user_id=?', [req.params.id, req.session.user.id]);
  if (!exams.length) { req.flash('error', 'Exam not found'); return res.redirect('/exam/setup'); }
  const exam = exams[0];
  if (exam.completed_at) return res.redirect(`/exam/${exam.id}/result`);

  const [answers] = await db.query(
    'SELECT ea.*, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.subject, q.chapter FROM exam_answers ea JOIN questions q ON q.id=ea.question_id WHERE ea.exam_id=?',
    [exam.id]
  );
  res.render('exam/take', { pageTitle: 'Exam', exam, questions: answers });
});

// POST submit exam
router.post('/:id/submit', isAuthenticated, async (req, res) => {
  const [exams] = await db.query('SELECT * FROM exams WHERE id=? AND user_id=?', [req.params.id, req.session.user.id]);
  if (!exams.length) return res.redirect('/exam/setup');
  const exam = exams[0];
  if (exam.completed_at) return res.redirect(`/exam/${exam.id}/result`);

  const answers = req.body.answers || {};
  const [examAnswers] = await db.query(
    'SELECT ea.id, ea.question_id, q.correct_answer FROM exam_answers ea JOIN questions q ON q.id=ea.question_id WHERE ea.exam_id=?',
    [exam.id]
  );

  let score = 0;
  for (const ea of examAnswers) {
    const selected = answers[ea.question_id] || null;
    const isCorrect = selected === ea.correct_answer ? 1 : 0;
    if (isCorrect) score++;
    await db.query('UPDATE exam_answers SET selected_answer=?, is_correct=? WHERE id=?', [selected, isCorrect, ea.id]);
  }
  await db.query('UPDATE exams SET score=?, completed_at=NOW() WHERE id=?', [score, exam.id]);
  res.redirect(`/exam/${exam.id}/result`);
});

// GET result
router.get('/:id/result', isAuthenticated, async (req, res) => {
  const [exams] = await db.query('SELECT * FROM exams WHERE id=? AND user_id=?', [req.params.id, req.session.user.id]);
  if (!exams.length) return res.redirect('/exam/setup');
  const exam = exams[0];
  const [answers] = await db.query(
    `SELECT ea.*, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
     q.correct_answer, q.explanation, q.explanation_bn, q.subject, q.exam_year, q.board
     FROM exam_answers ea JOIN questions q ON q.id=ea.question_id WHERE ea.exam_id=?`,
    [exam.id]
  );
  res.render('exam/result', { pageTitle: 'Exam Result', exam, answers });
});

// POST report question
router.post('/report', isAuthenticated, async (req, res) => {
  const { question_id, report_type, comment } = req.body;
  await db.query('INSERT INTO question_reports (question_id, reported_by, report_type, comment) VALUES (?,?,?,?)',
    [question_id, req.session.user.id, report_type, comment]);
  req.flash('success', 'Report submitted. Thank you!');
  res.redirect('back');
});

// GET exam history
router.get('/history/all', isAuthenticated, async (req, res) => {
  const [exams] = await db.query('SELECT * FROM exams WHERE user_id=? ORDER BY created_at DESC', [req.session.user.id]);
  res.render('exam/history', { pageTitle: 'Exam History', exams });
});

module.exports = router;
