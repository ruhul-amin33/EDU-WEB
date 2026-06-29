const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isTeacher } = require('../middleware/auth');

// ---- Helper: parse bulk-pasted question text into structured objects ----
function parseBulkQuestions(raw) {
  const blocks = raw.split(/\n\s*-{3,}\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map((block, idx) => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length);
    const q = { question_text: '', option_a: null, option_b: null, option_c: null, option_d: null, correct_answer: null, explanation: null, chapter: null, exam_year: null, board: null };
    const qLines = [];
    lines.forEach(line => {
      let m;
      if ((m = line.match(/^([A-D])[).]\s*(.+)/i))) {
        q['option_' + m[1].toLowerCase()] = m[2].trim();
      } else if ((m = line.match(/^Answer:\s*([A-D])/i))) {
        q.correct_answer = m[1].toLowerCase();
      } else if ((m = line.match(/^Explanation:\s*(.+)/i))) {
        q.explanation = m[1].trim();
      } else if ((m = line.match(/^Chapter:\s*(.+)/i))) {
        q.chapter = m[1].trim();
      } else if ((m = line.match(/^Year:\s*(.+)/i))) {
        q.exam_year = m[1].trim();
      } else if ((m = line.match(/^Board:\s*(.+)/i))) {
        q.board = m[1].trim();
      } else if ((m = line.match(/^Q:\s*(.+)/i))) {
        qLines.push(m[1].trim());
      } else {
        qLines.push(line);
      }
    });
    q.question_text = qLines.join(' ').trim();
    const errors = [];
    if (!q.question_text) errors.push('missing question text');
    if (!q.option_a || !q.option_b || !q.option_c || !q.option_d) errors.push('missing one or more options (A-D)');
    if (!q.correct_answer) errors.push('missing "Answer: X" line');
    return { index: idx + 1, data: q, errors };
  });
}

// Dashboard
router.get('/', isTeacher, async (req, res) => {
  const uid = req.session.user.id;
  const [[total]] = await db.query('SELECT COUNT(*) as c FROM questions WHERE created_by=?', [uid]);
  const [[pending]] = await db.query('SELECT COUNT(*) as c FROM questions WHERE created_by=? AND status="pending"', [uid]);
  const [[approved]] = await db.query('SELECT COUNT(*) as c FROM questions WHERE created_by=? AND status="approved"', [uid]);
  const [recent] = await db.query('SELECT * FROM questions WHERE created_by=? ORDER BY created_at DESC LIMIT 8', [uid]);
  res.render('teacher/dashboard', { pageTitle: 'Teacher Dashboard', stats: { total: total.c, pending: pending.c, approved: approved.c }, recent });
});

// Live duplicate-check while typing a question (AJAX)
router.get('/questions/check-duplicate', isTeacher, async (req, res) => {
  const text = (req.query.text || '').trim();
  if (text.length < 15) return res.json({ matches: [] });
  const snippet = text.slice(0, 60);
  const [rows] = await db.query(
    'SELECT id, question_text, status FROM questions WHERE question_text LIKE ? LIMIT 5',
    ['%' + snippet + '%']
  );
  res.json({ matches: rows });
});

// Bulk add — paste many questions at once
router.get('/questions/bulk-add', isTeacher, (req, res) => res.render('teacher/bulk-add-questions', { pageTitle: 'Bulk Add Questions' }));

router.post('/questions/bulk-add', isTeacher, async (req, res) => {
  const { raw_text, subject, level, stream, difficulty } = req.body;
  if (!raw_text || !subject || !level) {
    req.flash('error', 'Please select Subject and Level, and paste at least one question.');
    return res.redirect('/teacher/questions/bulk-add');
  }

  const parsed = parseBulkQuestions(raw_text);
  let successCount = 0;
  let skippedDup = 0;
  const failedBlocks = [];

  for (const item of parsed) {
    if (item.errors.length) {
      failedBlocks.push(`#${item.index}: ${item.errors.join(', ')}`);
      continue;
    }
    const [dupRows] = await db.query('SELECT id FROM questions WHERE question_text=? LIMIT 1', [item.data.question_text]);
    if (dupRows.length) { skippedDup++; continue; }

    await db.query(
      `INSERT INTO questions
        (question_text, option_a, option_b, option_c, option_d, correct_answer,
         explanation, subject, chapter, exam_year, board, level, stream, difficulty, created_by, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        item.data.question_text, item.data.option_a, item.data.option_b, item.data.option_c, item.data.option_d,
        item.data.correct_answer, item.data.explanation || null, subject, item.data.chapter || null,
        item.data.exam_year || null, item.data.board || null, level, stream || 'all', difficulty || 'medium',
        req.session.user.id, 'pending'
      ]
    );
    successCount++;
  }

  let msg = `✅ ${successCount} question(s) added and sent for admin approval.`;
  if (skippedDup) msg += ` ⚠️ ${skippedDup} skipped (already exists).`;
  if (failedBlocks.length) msg += ` ❌ ${failedBlocks.length} failed — ${failedBlocks.join(' | ')}`;

  req.flash(failedBlocks.length ? 'error' : 'success', msg);
  res.redirect('/teacher/questions/bulk-add');
});

// Add question
router.get('/questions/add', isTeacher, (req, res) => res.render('teacher/add-question', { pageTitle: 'Add Question' }));

router.post('/questions/add', isTeacher, async (req, res) => {
  const { question_text, question_text_bn, option_a, option_b, option_c, option_d, correct_answer, explanation, explanation_bn, subject, chapter, level, stream, difficulty, exam_year, board } = req.body;

  // Basic validation — catch empty required fields before hitting the DB
  if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_answer || !subject || !level) {
    req.flash('error', 'Please fill in all required fields (question, all 4 options, correct answer, subject, and level).');
    return res.redirect('/teacher/questions/add');
  }

  try {
    await db.query(
      `INSERT INTO questions
        (question_text, question_text_bn, option_a, option_b, option_c, option_d,
         correct_answer, explanation, explanation_bn, subject, chapter, exam_year, board, level,
         stream, difficulty, created_by, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        question_text, question_text_bn || null, option_a, option_b, option_c, option_d,
        correct_answer, explanation || null, explanation_bn || null, subject, chapter || null, exam_year || null, board || null, level,
        stream || 'all', difficulty || 'medium', req.session.user.id, 'pending'
      ]
    );
    req.flash('success', 'Question submitted for admin approval!');
    res.redirect('/teacher');
  } catch (err) {
    console.error('Add question error:', err);
    req.flash('error', 'Failed to save question. Please check all fields and try again.');
    res.redirect('/teacher/questions/add');
  }
});

// My questions
router.get('/questions', isTeacher, async (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM questions WHERE created_by=?';
  const params = [req.session.user.id];
  if (status) { query += ' AND status=?'; params.push(status); }
  query += ' ORDER BY created_at DESC';
  const [questions] = await db.query(query, params);
  res.render('teacher/questions', { pageTitle: 'My Questions', questions, filterStatus: status });
});

// Edit question (only rejected ones)
router.get('/questions/:id/edit', isTeacher, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM questions WHERE id=? AND created_by=?', [req.params.id, req.session.user.id]);
  if (!rows.length) { req.flash('error', 'Question not found'); return res.redirect('/teacher/questions'); }
  res.render('teacher/edit-question', { pageTitle: 'Edit Question', question: rows[0] });
});

router.post('/questions/:id/edit', isTeacher, async (req, res) => {
  const { question_text, question_text_bn, option_a, option_b, option_c, option_d, correct_answer, explanation, explanation_bn, subject, chapter, level, difficulty, exam_year, board } = req.body;
  await db.query(`UPDATE questions SET question_text=?,question_text_bn=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_answer=?,explanation=?,explanation_bn=?,subject=?,chapter=?,level=?,exam_year=?,board=?,difficulty=?,status="pending",admin_comment=NULL,teacher_fixed=1 WHERE id=? AND created_by=?`,
    [question_text, question_text_bn, option_a, option_b, option_c, option_d, correct_answer, explanation, explanation_bn, subject, chapter, level, exam_year || null, board || null, difficulty, req.params.id, req.session.user.id]);
  req.flash('success', 'Question updated and resubmitted!');
  res.redirect('/teacher/questions');
});

// Set exam for students — list existing templates + create new ones
router.get('/set-exam', isTeacher, async (req, res) => {
  // Subjects available across the WHOLE approved question bank (not just this teacher's own questions),
  // since admin/teacher should be able to build an exam from any approved question.
  const [subjects] = await db.query('SELECT DISTINCT subject FROM questions WHERE status="approved" ORDER BY subject');

  const [templates] = await db.query(
    `SELECT t.*, u.name AS creator_name
     FROM exam_templates t
     JOIN users u ON u.id = t.created_by
     ORDER BY t.created_at DESC`
  );

  res.render('teacher/set-exam', { pageTitle: 'Set Exam', subjects, templates });
});

router.post('/set-exam', isTeacher, async (req, res) => {
  const { title, level, stream, subject, chapter, question_count, time_limit } = req.body;

  const qCount = parseInt(question_count, 10);
  const tLimit = parseInt(time_limit, 10);

  if (!title || !level || !qCount || qCount < 1 || qCount > 200 || !tLimit || tLimit < 1 || tLimit > 600) {
    req.flash('error', 'Please provide a title, level, a valid question count (1-200), and time limit (1-600 minutes).');
    return res.redirect('/teacher/set-exam');
  }

  // Make sure enough approved questions actually exist for this filter combo before creating the template
  let checkQuery = 'SELECT COUNT(*) as c FROM questions WHERE status="approved" AND level=?';
  const checkParams = [level];
  if (stream && stream !== 'all') { checkQuery += ' AND (stream=? OR stream="all")'; checkParams.push(stream); }
  if (subject) { checkQuery += ' AND subject=?'; checkParams.push(subject); }
  if (chapter) { checkQuery += ' AND chapter=?'; checkParams.push(chapter); }
  const [[{ c: available }]] = await db.query(checkQuery, checkParams);

  if (available < qCount) {
    req.flash('error', `Only ${available} approved question(s) match these filters — reduce the question count or broaden the filters.`);
    return res.redirect('/teacher/set-exam');
  }

  await db.query(
    `INSERT INTO exam_templates (title, level, stream, subject, chapter, question_count, time_limit, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [title, level, stream || 'all', subject || null, chapter || null, qCount, tLimit, req.session.user.id]
  );

  req.flash('success', 'Exam created! Students can now find and take it from their dashboard.');
  res.redirect('/teacher/set-exam');
});

router.post('/set-exam/:id/toggle', isTeacher, async (req, res) => {
  await db.query('UPDATE exam_templates SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Exam visibility updated.');
  res.redirect('/teacher/set-exam');
});

router.post('/set-exam/:id/delete', isTeacher, async (req, res) => {
  await db.query('DELETE FROM exam_templates WHERE id=?', [req.params.id]);
  req.flash('success', 'Exam deleted.');
  res.redirect('/teacher/set-exam');
});

module.exports = router;
