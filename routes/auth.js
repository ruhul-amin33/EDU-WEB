const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// GET Login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { pageTitle: 'Login' });
});

// POST Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) { req.flash('error', 'Invalid email or password'); return res.redirect('/auth/login'); }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) { req.flash('error', 'Invalid email or password'); return res.redirect('/auth/login'); }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, stream: user.stream, level: user.level, hsc_session: user.hsc_session };
    req.flash('success', `Welcome back, ${user.name}!`);
    if (user.role === 'admin') return res.redirect('/admin');
    if (user.role === 'teacher') return res.redirect('/teacher');
    if (!user.stream) return res.redirect('/student/setup');
    res.redirect('/student');
  } catch (e) { console.error(e); req.flash('error', 'Server error'); res.redirect('/auth/login'); }
});

// GET Register
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register', { pageTitle: 'Register' });
});

// POST Register
router.post('/register', async (req, res) => {
  const { name, email, password, confirm_password } = req.body;
  if (password !== confirm_password) { req.flash('error', 'Passwords do not match'); return res.redirect('/auth/register'); }
  if (password.length < 6) { req.flash('error', 'Password must be at least 6 characters'); return res.redirect('/auth/register'); }
  try {
    const [exist] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exist.length) { req.flash('error', 'Email already registered'); return res.redirect('/auth/register'); }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query('INSERT INTO users (name, email, password, is_verified) VALUES (?,?,?,1)', [name, email, hash]);
    req.session.user = { id: result.insertId, name, email, role: 'student', stream: null, level: null };
    req.flash('success', 'Registration successful! Please select your stream.');
    res.redirect('/student/setup');
  } catch (e) { console.error(e); req.flash('error', 'Registration failed'); res.redirect('/auth/register'); }
});

// GET Forgot Password
router.get('/forgot', (req, res) => res.render('auth/forgot', { pageTitle: 'Forgot Password' }));

// POST Forgot Password
router.post('/forgot', async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) { req.flash('info', 'If this email exists, a reset link was sent.'); return res.redirect('/auth/forgot'); }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000);
    await db.query('UPDATE users SET reset_token=?, reset_expires=? WHERE email=?', [token, expires, email]);
    const resetUrl = `${process.env.BASE_URL}/auth/reset/${token}`;
    // Attempt to send email (won't fail if not configured)
    try {
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
      await transporter.sendMail({ from: 'Parafin <noreply@parafin.com>', to: email, subject: 'Password Reset - Parafin', html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>` });
    } catch(mailErr) { console.log('Email not sent:', mailErr.message); }
    req.flash('info', 'Password reset link sent to your email (if account exists).');
    res.redirect('/auth/forgot');
  } catch (e) { console.error(e); req.flash('error', 'Something went wrong'); res.redirect('/auth/forgot'); }
});

// GET Reset Password
router.get('/reset/:token', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE reset_token=? AND reset_expires > NOW()', [req.params.token]);
  if (!rows.length) { req.flash('error', 'Invalid or expired reset link'); return res.redirect('/auth/forgot'); }
  res.render('auth/reset', { pageTitle: 'Reset Password', token: req.params.token });
});

// POST Reset Password
router.post('/reset/:token', async (req, res) => {
  const { password, confirm_password } = req.body;
  if (password !== confirm_password) { req.flash('error', 'Passwords do not match'); return res.redirect('back'); }
  const [rows] = await db.query('SELECT * FROM users WHERE reset_token=? AND reset_expires > NOW()', [req.params.token]);
  if (!rows.length) { req.flash('error', 'Invalid or expired link'); return res.redirect('/auth/forgot'); }
  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password=?, reset_token=NULL, reset_expires=NULL WHERE id=?', [hash, rows[0].id]);
  req.flash('success', 'Password reset successful! Please login.');
  res.redirect('/auth/login');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
