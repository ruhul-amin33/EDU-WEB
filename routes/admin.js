const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const path = require('path');
const ExcelJS = require('exceljs');
const { isAdmin } = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;

// Cloudinary is used for ALL uploads (PDFs, avatars, thumbnails) because Render's local
// disk is ephemeral — any file written to /uploads disappears on the next deploy/restart.
// If Cloudinary env vars are missing (e.g. local dev without a Cloudinary account), we
// transparently fall back to local disk storage so the app still works.
//
// We talk to Cloudinary directly (cloudinary v2 SDK) instead of using the
// multer-storage-cloudinary adapter package, because that package only supports
// cloudinary v1, which has a known high-severity vulnerability (GHSA-g4mf-96x5-5m2c).
const cloudinaryConfigured = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
} else {
  console.warn('[Parafin] Cloudinary env vars not set — falling back to local disk storage. ' +
    'On Render, uploaded files will NOT persist across restarts/redeploys without Cloudinary.');
}

// Uploads a buffer (from multer.memoryStorage()) to Cloudinary and resolves with the
// secure URL. resourceType should be 'image' for photos/thumbnails or 'raw' for PDFs.
function uploadBufferToCloudinary(buffer, folder, resourceType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// Express middleware factory: after multer.memoryStorage() parses the upload into
// req.file.buffer, this uploads it to Cloudinary (if configured) and rewrites
// req.file.path to the resulting secure URL. If Cloudinary isn't configured, this
// instead writes the buffer to local disk (mimicking the original local-disk layout
// the rest of the app expects) and sets req.file.filename.
function persistUpload(folder, resourceType, localSubdir) {
  return async (req, res, next) => {
    if (!req.file) return next();
    try {
      if (cloudinaryConfigured) {
        const result = await uploadBufferToCloudinary(req.file.buffer, folder, resourceType);
        req.file.path = result.secure_url;
      } else {
        const fs = require('fs');
        const destDir = path.join(__dirname, '..', 'uploads', localSubdir || '');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const ext = path.extname(req.file.originalname) || (resourceType === 'raw' ? '.pdf' : '');
        const prefix = localSubdir === '' ? 'course-' : '';
        const filename = prefix + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
        fs.writeFileSync(path.join(destDir, filename), req.file.buffer);
        req.file.filename = filename;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---- PDF storage (study materials) ----
const uploadPDF = multer({
  storage: multer.memoryStorage(),
  fileFilter: (r, f, cb) => cb(null, f.mimetype === 'application/pdf'),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB cap — comfortable for question banks/notes, safe for free-tier hosting
});
const persistPDF = persistUpload('parafin/pdfs', 'raw', 'pdfs');

// ---- Avatar storage (team member photos) ----
const uploadAvatar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB cap
const persistAvatar = persistUpload('parafin/avatars', 'image', 'avatars');

// ---- Course thumbnail storage ----
const uploadThumb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB cap
// Local fallback writes straight into uploads/ (no subfolder) to match the existing
// /uploads/<filename> URL pattern used by the views for course thumbnails.
const persistThumb = persistUpload('parafin/thumbnails', 'image', '');

// ---- Site logo storage ----
const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB cap
const persistLogo = persistUpload('parafin/branding', 'image', 'branding');

// Cloudinary's storage engine puts the full URL on req.file.path; local disk storage
// puts the bare filename on req.file.filename. This helper picks whichever is correct
// so every route below works identically with either backend.
function storedFileRef(file) {
  if (!file) return null;
  return cloudinaryConfigured ? file.path : file.filename;
}

// Dashboard
router.get('/', isAdmin, async (req, res) => {
  // Each count is independent — if one query fails (e.g. a column/table
  // mismatch after a migration), the rest of the dashboard still loads
  // instead of the whole page (or the server) crashing.
  async function safeCount(sql) {
    try {
      const [[row]] = await db.query(sql);
      return row.c;
    } catch (err) {
      console.error('Admin dashboard count query failed:', sql, err.message);
      return 0;
    }
  }

  const [users, questions, courses, materials, purchases, reviews] = await Promise.all([
    safeCount('SELECT COUNT(*) as c FROM users WHERE role="student"'),
    safeCount('SELECT COUNT(*) as c FROM questions WHERE status="pending"'),
    safeCount('SELECT COUNT(*) as c FROM courses'),
    safeCount('SELECT COUNT(*) as c FROM study_materials'),
    safeCount('SELECT COUNT(*) as c FROM course_purchases WHERE status="pending"'),
    safeCount('SELECT COUNT(*) as c FROM reviews WHERE is_approved=0')
  ]);

  res.render('admin/dashboard', { pageTitle: 'Admin Dashboard', stats: { users, pendingQ: questions, courses, materials, pendingPurchases: purchases, pendingReviews: reviews } });
});

// ---- MATERIAL MANAGER (folder tree, free-form names) ----

// Helper: fetch full folder tree as nested array
async function getFolderTree() {
  const [rows] = await db.query('SELECT * FROM categories ORDER BY sort_order, name');
  const byId = {};
  rows.forEach(r => { r.children = []; byId[r.id] = r; });
  const roots = [];
  rows.forEach(r => {
    if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].children.push(r);
    else roots.push(r);
  });
  return roots;
}

// Main material manager page — shows folder tree + current folder contents
router.get('/materials', isAdmin, async (req, res) => {
  const folderId = req.query.folder ? parseInt(req.query.folder) : null;
  const tree = await getFolderTree();

  let currentFolder = null;
  let breadcrumb = [];
  let subfolders = [];
  let files = [];

  if (folderId) {
    const [rows] = await db.query('SELECT * FROM categories WHERE id=?', [folderId]);
    if (rows.length) {
      currentFolder = rows[0];
      // build breadcrumb by walking up parent_id
      let node = currentFolder;
      breadcrumb.unshift(node);
      while (node.parent_id) {
        const [p] = await db.query('SELECT * FROM categories WHERE id=?', [node.parent_id]);
        if (!p.length) break;
        node = p[0];
        breadcrumb.unshift(node);
      }
    }
  }

  const [subRows] = await db.query('SELECT * FROM categories WHERE parent_id ' + (folderId ? '=?' : 'IS NULL') + ' ORDER BY sort_order, name', folderId ? [folderId] : []);
  subfolders = subRows;

  const [fileRows] = await db.query(
    'SELECT sm.*, u.name as uploader FROM study_materials sm JOIN users u ON u.id=sm.uploaded_by WHERE sm.category_id ' + (folderId ? '=?' : 'IS NULL') + ' ORDER BY sm.created_at DESC',
    folderId ? [folderId] : []
  );
  files = fileRows;

  const [allFolders] = await db.query('SELECT id, name, parent_id FROM categories ORDER BY name');

  res.render('admin/materials', {
    pageTitle: 'Material Manager',
    tree, currentFolder, breadcrumb, subfolders, files, allFolders,
    currentFolderId: folderId
  });
});

// Create folder (any name, any parent)
router.post('/materials/folder/add', isAdmin, async (req, res) => {
  const { name, name_bn, parent_id, icon } = req.body;
  await db.query('INSERT INTO categories (name, name_bn, parent_id, icon) VALUES (?,?,?,?)',
    [name, name_bn || name, parent_id || null, icon || '📁']);
  req.flash('success', `Folder "${name}" created!`);
  res.redirect('/admin/materials' + (parent_id ? '?folder=' + parent_id : ''));
});

// Rename folder
router.post('/materials/folder/:id/rename', isAdmin, async (req, res) => {
  const { name, name_bn, icon } = req.body;
  await db.query('UPDATE categories SET name=?, name_bn=?, icon=? WHERE id=?', [name, name_bn || name, icon || '📁', req.params.id]);
  const [rows] = await db.query('SELECT parent_id FROM categories WHERE id=?', [req.params.id]);
  req.flash('success', 'Folder renamed!');
  res.redirect('/admin/materials' + (rows[0] && rows[0].parent_id ? '?folder=' + rows[0].parent_id : ''));
});

// Delete folder (cascades to subfolders + files via FK)
router.post('/materials/folder/:id/delete', isAdmin, async (req, res) => {
  const [rows] = await db.query('SELECT parent_id FROM categories WHERE id=?', [req.params.id]);
  const parentId = rows[0] ? rows[0].parent_id : null;
  await db.query('DELETE FROM categories WHERE id=?', [req.params.id]);
  req.flash('success', 'Folder deleted.');
  res.redirect('/admin/materials' + (parentId ? '?folder=' + parentId : ''));
});

// Upload PDF into a folder
router.post('/materials/upload', isAdmin, uploadPDF.single('pdf'), persistPDF, async (req, res) => {
  const { title, title_bn, description, category_id, year, subject } = req.body;
  if (!req.file) { req.flash('error', 'Please upload a PDF file'); return res.redirect('/admin/materials' + (category_id ? '?folder=' + category_id : '')); }
  const fileSize = (req.file.size / 1024 / 1024).toFixed(2) + ' MB';
  await db.query('INSERT INTO study_materials (title, title_bn, description, category_id, year, subject, file_path, file_size, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)',
    [title, title_bn || title, description, category_id || null, year, subject, storedFileRef(req.file), fileSize, req.session.user.id]);
  req.flash('success', 'PDF uploaded successfully!');
  res.redirect('/admin/materials' + (category_id ? '?folder=' + category_id : ''));
});

router.post('/materials/:id/delete', isAdmin, async (req, res) => {
  const [rows] = await db.query('SELECT category_id FROM study_materials WHERE id=?', [req.params.id]);
  const catId = rows[0] ? rows[0].category_id : null;
  await db.query('DELETE FROM study_materials WHERE id=?', [req.params.id]);
  req.flash('success', 'Material deleted.');
  res.redirect('/admin/materials' + (catId ? '?folder=' + catId : ''));
});

// Search materials/folders (admin)
router.get('/materials/search', isAdmin, async (req, res) => {
  const q = req.query.q || '';
  const [folders] = await db.query('SELECT * FROM categories WHERE name LIKE ? OR name_bn LIKE ? LIMIT 20', [`%${q}%`, `%${q}%`]);
  const [files] = await db.query('SELECT * FROM study_materials WHERE title LIKE ? OR title_bn LIKE ? LIMIT 20', [`%${q}%`, `%${q}%`]);
  res.json({ folders, files });
});

// ---- APPEARANCE (Color Theme + Font Size) ----
router.get('/appearance', isAdmin, async (req, res) => {
  const [themeRows] = await db.query('SELECT setting_value FROM settings WHERE setting_key="site_theme"');
  const [fontRows] = await db.query('SELECT setting_value FROM settings WHERE setting_key="site_font_size"');
  const [fontFamilyRows] = await db.query('SELECT setting_value FROM settings WHERE setting_key="site_font_family"');
  const [spacingRows] = await db.query('SELECT setting_value FROM settings WHERE setting_key="hero_spacing"');
  const [decoRows] = await db.query('SELECT setting_value FROM settings WHERE setting_key="deco_style"');
  const [layoutRows] = await db.query('SELECT setting_value FROM settings WHERE setting_key="layout_style"');
  const currentTheme = themeRows[0] ? themeRows[0].setting_value : 'default';
  const currentFontSize = fontRows[0] ? fontRows[0].setting_value : 'standard';
  const currentFontFamily = fontFamilyRows[0] ? fontFamilyRows[0].setting_value : 'inter';
  const currentHeroSpacing = spacingRows[0] ? spacingRows[0].setting_value : 'normal';
  const currentDecoStyle = decoRows[0] ? decoRows[0].setting_value : 'modern';
  const currentLayoutStyle = layoutRows[0] ? layoutRows[0].setting_value : 'classic';
  res.render('admin/appearance', { pageTitle: 'Site Appearance', currentTheme, currentFontSize, currentFontFamily, currentHeroSpacing, currentDecoStyle, currentLayoutStyle });
});

router.post('/appearance/theme', isAdmin, async (req, res) => {
  const { theme_name } = req.body;
  await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ("site_theme", ?) ON DUPLICATE KEY UPDATE setting_value=?', [theme_name, theme_name]);
  await require('../middleware/auth').refreshSiteTheme();
  req.flash('success', 'Color theme updated! All visitors will see it instantly.');
  res.redirect('/admin/appearance');
});

router.post('/appearance/font-size', isAdmin, async (req, res) => {
  const { font_size } = req.body;
  await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ("site_font_size", ?) ON DUPLICATE KEY UPDATE setting_value=?', [font_size, font_size]);
  await require('../middleware/auth').refreshFontSize();
  req.flash('success', 'Font size updated for the whole website!');
  res.redirect('/admin/appearance');
});

router.post('/appearance/font-family', isAdmin, async (req, res) => {
  const { font_family } = req.body;
  await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ("site_font_family", ?) ON DUPLICATE KEY UPDATE setting_value=?', [font_family, font_family]);
  await require('../middleware/auth').refreshSettings();
  req.flash('success', 'Font updated for the whole website!');
  res.redirect('/admin/appearance');
});

router.post('/appearance/hero-spacing', isAdmin, async (req, res) => {
  const { hero_spacing } = req.body;
  await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ("hero_spacing", ?) ON DUPLICATE KEY UPDATE setting_value=?', [hero_spacing, hero_spacing]);
  await require('../middleware/auth').refreshSettings();
  req.flash('success', 'Hero spacing updated!');
  res.redirect('/admin/appearance');
});

router.post('/appearance/deco-style', isAdmin, async (req, res) => {
  const { deco_style } = req.body;
  await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ("deco_style", ?) ON DUPLICATE KEY UPDATE setting_value=?', [deco_style, deco_style]);
  await require('../middleware/auth').refreshSettings();
  req.flash('success', 'Decoration style updated! All visitors will see it instantly.');
  res.redirect('/admin/appearance');
});

router.post('/appearance/layout-style', isAdmin, async (req, res) => {
  const { layout_style } = req.body;
  await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ("layout_style", ?) ON DUPLICATE KEY UPDATE setting_value=?', [layout_style, layout_style]);
  await require('../middleware/auth').refreshSettings();
  req.flash('success', 'Layout style updated! It now applies across the entire site — homepage, dashboards, courses, and admin panels.');
  res.redirect('/admin/appearance');
});

// ---- SITE CONTENT EDITOR ----
// Admin can edit any homepage text, social links, and contact info without touching code.
router.get('/content', isAdmin, async (req, res) => {
  const authMiddleware = require('../middleware/auth');
  await authMiddleware.refreshSettings();
  const settings = authMiddleware.getSettings();
  res.render('admin/content', { pageTitle: 'Site Content', settings });
});

router.post('/content', isAdmin, async (req, res) => {
  // Whitelist of editable keys — prevents arbitrary key injection from the form
  const editableKeys = [
    'site_name',
    'hero_badge_en', 'hero_badge_bn',
    'hero_title_en', 'hero_title_bn',
    'hero_subtitle_en', 'hero_subtitle_bn',
    'stat_students', 'stat_questions', 'stat_pdfs', 'stat_satisfaction',
    'footer_about_en', 'footer_about_bn',
    'facebook_url', 'telegram_url', 'youtube_url', 'whatsapp_number',
    'support_email', 'support_phone',
    'footer_copyright_en', 'footer_copyright_bn',
    'footer_tagline_en', 'footer_tagline_bn',
  ];

  try {
    for (const key of editableKeys) {
      if (typeof req.body[key] !== 'undefined') {
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [key, req.body[key], req.body[key]]
        );
      }
    }
    await require('../middleware/auth').refreshSettings();
    req.flash('success', 'Site content updated! Changes are live now.');
  } catch (err) {
    console.error('Content update error:', err);
    req.flash('error', 'Failed to save content. Please try again.');
  }
  res.redirect('/admin/content');
});

router.post('/content/logo', isAdmin, uploadLogo.single('logo'), persistLogo, async (req, res) => {
  if (!req.file) {
    req.flash('error', 'Please choose an image file first.');
    return res.redirect('/admin/content');
  }
  const logoUrl = storedFileRef(req.file);
  const finalUrl = cloudinaryConfigured ? logoUrl : '/uploads/branding/' + logoUrl;
  await db.query(
    'INSERT INTO settings (setting_key, setting_value) VALUES ("site_logo", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
    [finalUrl, finalUrl]
  );
  await require('../middleware/auth').refreshSettings();
  req.flash('success', 'Logo updated! It will now show everywhere on the site.');
  res.redirect('/admin/content');
});

// ---- QUESTIONS ----
router.get('/questions', isAdmin, async (req, res) => {
  const { status } = req.query;
  let query = 'SELECT q.*, u.name as teacher_name FROM questions q JOIN users u ON u.id=q.created_by';
  const params = [];
  if (status) { query += ' WHERE q.status=?'; params.push(status); }
  query += ' ORDER BY q.created_at DESC';
  const [questions] = await db.query(query, params);
  res.render('admin/questions', { pageTitle: 'Manage Questions', questions, filterStatus: status });
});

router.post('/questions/bulk-approve', isAdmin, async (req, res) => {
  let ids = req.body['ids[]'] || req.body.ids;
  if (!ids) {
    req.flash('error', 'No questions were selected.');
    return res.redirect('/admin/questions?status=pending');
  }
  if (!Array.isArray(ids)) ids = [ids];
  await db.query('UPDATE questions SET status="approved" WHERE id IN (?)', [ids]);
  req.flash('success', `${ids.length} question(s) approved!`);
  res.redirect('/admin/questions?status=pending');
});

router.post('/questions/:id/approve', isAdmin, async (req, res) => {
  await db.query('UPDATE questions SET status="approved" WHERE id=?', [req.params.id]);
  req.flash('success', 'Question approved!');
  res.redirect('/admin/questions?status=pending');
});

router.post('/questions/:id/reject', isAdmin, async (req, res) => {
  await db.query('UPDATE questions SET status="rejected" WHERE id=?', [req.params.id]);
  req.flash('success', 'Question rejected.');
  res.redirect('/admin/questions?status=pending');
});

router.post('/questions/:id/comment', isAdmin, async (req, res) => {
  const { comment } = req.body;
  await db.query('UPDATE questions SET admin_comment=?, status="rejected" WHERE id=?', [comment, req.params.id]);
  req.flash('success', 'Comment sent to teacher.');
  res.redirect('/admin/questions');
});

router.post('/questions/:id/delete', isAdmin, async (req, res) => {
  await db.query('DELETE FROM questions WHERE id=?', [req.params.id]);
  req.flash('success', 'Question deleted.');
  res.redirect('/admin/questions');
});

// ---- REPORTS ----
router.get('/reports', isAdmin, async (req, res) => {
  const [reports] = await db.query(`SELECT qr.*, u.name as reporter_name, q.question_text, q.subject 
    FROM question_reports qr JOIN users u ON u.id=qr.reported_by JOIN questions q ON q.id=qr.question_id 
    WHERE qr.status="open" ORDER BY qr.created_at DESC`);
  res.render('admin/reports', { pageTitle: 'Question Reports', reports });
});

router.post('/reports/:id/resolve', isAdmin, async (req, res) => {
  const { admin_comment } = req.body;
  await db.query('UPDATE question_reports SET status="admin_reviewed", admin_comment=? WHERE id=?', [admin_comment, req.params.id]);
  req.flash('success', 'Report marked as reviewed.');
  res.redirect('/admin/reports');
});

// ---- COURSES ----
router.get('/courses', isAdmin, async (req, res) => {
  const [courses] = await db.query('SELECT * FROM courses ORDER BY created_at DESC');
  res.render('admin/courses', { pageTitle: 'Manage Courses', courses });
});

router.post('/courses/add', isAdmin, uploadThumb.single('thumbnail'), persistThumb, async (req, res) => {
  const { title, title_bn, description, description_bn, price, original_price, level, stream, session, board, is_admission, instructor, duration, total_lessons } = req.body;
  await db.query(
    `INSERT INTO courses
      (title,title_bn,description,description_bn,price,original_price,level,stream,session,board,is_admission,thumbnail,instructor,duration,total_lessons,is_published)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    [title, title_bn, description, description_bn, price||0, original_price||0, level, stream||'all',
     session || null, board || null, is_admission ? 1 : 0,
     storedFileRef(req.file), instructor, duration, total_lessons||0]
  );
  req.flash('success', 'Course added!');
  res.redirect('/admin/courses');
});

router.post('/courses/:id/toggle', isAdmin, async (req, res) => {
  await db.query('UPDATE courses SET is_published=NOT is_published WHERE id=?', [req.params.id]);
  res.redirect('/admin/courses');
});

router.post('/courses/:id/delete', isAdmin, async (req, res) => {
  await db.query('DELETE FROM courses WHERE id=?', [req.params.id]);
  req.flash('success', 'Course deleted.');
  res.redirect('/admin/courses');
});

// ---- PURCHASES ----
router.get('/purchases', isAdmin, async (req, res) => {
  const [purchases] = await db.query(`SELECT cp.*, u.name as student_name, u.email, c.title as course_title 
    FROM course_purchases cp JOIN users u ON u.id=cp.user_id JOIN courses c ON c.id=cp.course_id 
    ORDER BY cp.purchased_at DESC`);
  res.render('admin/purchases', { pageTitle: 'Purchase Requests', purchases });
});

router.post('/purchases/:id/approve', isAdmin, async (req, res) => {
  await db.query('UPDATE course_purchases SET status="completed" WHERE id=?', [req.params.id]);
  req.flash('success', 'Purchase approved!');
  res.redirect('/admin/purchases');
});

router.post('/purchases/:id/reject', isAdmin, async (req, res) => {
  await db.query('UPDATE course_purchases SET status="failed" WHERE id=?', [req.params.id]);
  req.flash('success', 'Purchase rejected.');
  res.redirect('/admin/purchases');
});

// ---- TEAM ----
router.get('/team', isAdmin, async (req, res) => {
  const [team] = await db.query('SELECT * FROM team_members ORDER BY sort_order');
  res.render('admin/team', { pageTitle: 'Manage Team', team });
});

router.post('/team/add', isAdmin, uploadAvatar.single('photo'), persistAvatar, async (req, res) => {
  const { name, name_bn, role, role_bn, description, description_bn, facebook, telegram, youtube, whatsapp, sort_order } = req.body;
  await db.query(
    `INSERT INTO team_members
      (name,name_bn,role,role_bn,description,description_bn,photo,facebook,telegram,youtube,whatsapp,sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [name, name_bn, role, role_bn, description, description_bn, storedFileRef(req.file), facebook||null, telegram||null, youtube||null, whatsapp||null, sort_order||0]
  );
  req.flash('success', 'Team member added!');
  res.redirect('/admin/team');
});

// Edit an existing team member — every field is editable, photo only replaced if a new file is uploaded
router.post('/team/:id/edit', isAdmin, uploadAvatar.single('photo'), persistAvatar, async (req, res) => {
  const { name, name_bn, role, role_bn, description, description_bn, facebook, telegram, youtube, whatsapp, sort_order, is_active } = req.body;

  if (req.file) {
    await db.query(
      `UPDATE team_members SET
        name=?, name_bn=?, role=?, role_bn=?, description=?, description_bn=?,
        photo=?, facebook=?, telegram=?, youtube=?, whatsapp=?, sort_order=?, is_active=?
       WHERE id=?`,
      [name, name_bn, role, role_bn, description, description_bn,
       storedFileRef(req.file), facebook||null, telegram||null, youtube||null, whatsapp||null, sort_order||0, is_active?1:0,
       req.params.id]
    );
  } else {
    await db.query(
      `UPDATE team_members SET
        name=?, name_bn=?, role=?, role_bn=?, description=?, description_bn=?,
        facebook=?, telegram=?, youtube=?, whatsapp=?, sort_order=?, is_active=?
       WHERE id=?`,
      [name, name_bn, role, role_bn, description, description_bn,
       facebook||null, telegram||null, youtube||null, whatsapp||null, sort_order||0, is_active?1:0,
       req.params.id]
    );
  }
  req.flash('success', 'Team member updated!');
  res.redirect('/admin/team');
});

router.post('/team/:id/delete', isAdmin, async (req, res) => {
  await db.query('DELETE FROM team_members WHERE id=?', [req.params.id]);
  req.flash('success', 'Member removed.');
  res.redirect('/admin/team');
});

// ---- REVIEWS ----
router.get('/reviews', isAdmin, async (req, res) => {
  const [reviews] = await db.query(`
    SELECT r.*,
           COALESCE(u.name, r.display_name) AS student_name,
           u.email AS student_email
    FROM reviews r
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
  `);
  res.render('admin/reviews', { pageTitle: 'Manage Reviews', reviews });
});

// Admin creates a standalone review/testimonial (not tied to a real student account)
router.post('/reviews/add', isAdmin, async (req, res) => {
  const { display_name, display_role, rating, review_text } = req.body;
  if (!display_name || !review_text) {
    req.flash('error', 'Name and review text are required.');
    return res.redirect('/admin/reviews');
  }
  await db.query(
    'INSERT INTO reviews (display_name, display_role, rating, review_text, is_approved, created_by_admin) VALUES (?,?,?,?,1,1)',
    [display_name, display_role || null, rating || 5, review_text]
  );
  req.flash('success', 'Review added and published!');
  res.redirect('/admin/reviews');
});

router.post('/reviews/:id/approve', isAdmin, async (req, res) => {
  await db.query('UPDATE reviews SET is_approved=1 WHERE id=?', [req.params.id]);
  req.flash('success', 'Review approved!');
  res.redirect('/admin/reviews');
});

router.post('/reviews/:id/delete', isAdmin, async (req, res) => {
  await db.query('DELETE FROM reviews WHERE id=?', [req.params.id]);
  req.flash('success', 'Review deleted.');
  res.redirect('/admin/reviews');
});

// ---- USERS ----
router.get('/users', isAdmin, async (req, res) => {
  const [users] = await db.query('SELECT * FROM users ORDER BY created_at DESC');
  res.render('admin/users', { pageTitle: 'Manage Users', users });
});

router.post('/users/:id/role', isAdmin, async (req, res) => {
  const { role } = req.body;
  await db.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  req.flash('success', 'User role updated.');
  res.redirect('/admin/users');
});

// Admin sets a new password for a user (passwords are hashed — they cannot be "viewed",
// but admin can instantly issue a new one to share with a locked-out student/teacher)
router.post('/users/:id/reset-password', isAdmin, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  let { new_password } = req.body;

  // If admin leaves it blank, auto-generate a readable temp password
  if (!new_password || !new_password.trim()) {
    new_password = 'Parafin' + crypto.randomInt(1000, 9999);
  }
  if (new_password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect('/admin/users');
  }

  const hash = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE users SET password=? WHERE id=?', [hash, req.params.id]);

  // Store the plain password ONLY in a one-time flash message — never persisted to DB
  req.flash('info', `Password updated! New password: "${new_password}" — copy and share this with the user now, it will not be shown again.`);
  res.redirect('/admin/users');
});

// ---- EXAM RESULTS (view all student exams + Excel export) ----
router.get('/exam-results', isAdmin, async (req, res) => {
  const { level, stream, subject, from_date, to_date, search } = req.query;

  let query = `
    SELECT e.*, u.name as student_name, u.email as student_email
    FROM exams e
    JOIN users u ON u.id = e.user_id
    WHERE e.completed_at IS NOT NULL
  `;
  const params = [];

  if (level) { query += ' AND e.level=?'; params.push(level); }
  if (stream && stream !== 'all') { query += ' AND e.stream=?'; params.push(stream); }
  if (subject) { query += ' AND e.subject=?'; params.push(subject); }
  if (from_date) { query += ' AND DATE(e.completed_at) >= ?'; params.push(from_date); }
  if (to_date) { query += ' AND DATE(e.completed_at) <= ?'; params.push(to_date); }
  if (search) { query += ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY e.completed_at DESC LIMIT 500';

  const [exams] = await db.query(query, params);
  const [subjects] = await db.query('SELECT DISTINCT subject FROM exams WHERE subject IS NOT NULL ORDER BY subject');

  const [[summary]] = await db.query(`
    SELECT COUNT(*) as total_exams, COUNT(DISTINCT user_id) as total_students,
           AVG(score/total_questions*100) as avg_score
    FROM exams WHERE completed_at IS NOT NULL
  `);

  res.render('admin/exam-results', {
    pageTitle: 'Exam Results',
    exams, subjects, filters: req.query, summary
  });
});

// Excel export — applies the SAME filters as the results page
router.get('/exam-results/export', isAdmin, async (req, res) => {
  const { level, stream, subject, from_date, to_date, search } = req.query;

  let query = `
    SELECT e.id, u.name as student_name, u.email as student_email,
           e.level, e.stream, e.subject, e.question_count, e.time_limit,
           e.score, e.total_questions, e.completed_at, e.created_at
    FROM exams e
    JOIN users u ON u.id = e.user_id
    WHERE e.completed_at IS NOT NULL
  `;
  const params = [];

  if (level) { query += ' AND e.level=?'; params.push(level); }
  if (stream && stream !== 'all') { query += ' AND e.stream=?'; params.push(stream); }
  if (subject) { query += ' AND e.subject=?'; params.push(subject); }
  if (from_date) { query += ' AND DATE(e.completed_at) >= ?'; params.push(from_date); }
  if (to_date) { query += ' AND DATE(e.completed_at) <= ?'; params.push(to_date); }
  if (search) { query += ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY e.completed_at DESC';

  const [exams] = await db.query(query, params);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Parafin';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Exam Results');

  // Header row
  sheet.columns = [
    { header: '#', key: 'idx', width: 6 },
    { header: 'Student Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Level', key: 'level', width: 10 },
    { header: 'Stream', key: 'stream', width: 12 },
    { header: 'Subject', key: 'subject', width: 18 },
    { header: 'Questions', key: 'qcount', width: 11 },
    { header: 'Time Limit (min)', key: 'timelimit', width: 14 },
    { header: 'Score', key: 'score', width: 9 },
    { header: 'Total', key: 'total', width: 9 },
    { header: 'Percentage', key: 'pct', width: 12 },
    { header: 'Grade', key: 'grade', width: 9 },
    { header: 'Completed At', key: 'completed', width: 20 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B6CF9' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  exams.forEach((e, i) => {
    const pct = e.total_questions ? Math.round((e.score / e.total_questions) * 100) : 0;
    const grade = pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : 'F';

    const row = sheet.addRow({
      idx: i + 1,
      name: e.student_name,
      email: e.student_email,
      level: e.level ? e.level.toUpperCase() : '',
      stream: e.stream || '',
      subject: e.subject || 'Mixed',
      qcount: e.question_count,
      timelimit: e.time_limit,
      score: e.score,
      total: e.total_questions,
      pct: pct + '%',
      grade: grade,
      completed: e.completed_at ? new Date(e.completed_at).toLocaleString('en-BD') : '',
    });

    // Color-code the grade cell
    const gradeCell = row.getCell('grade');
    const gradeColors = { 'A+': 'FF22C55E', 'A': 'FF4ADE80', 'B': 'FFF59E0B', 'C': 'FFFB923C', 'F': 'FFEF4444' };
    gradeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gradeColors[grade] || 'FFFFFFFF' } };
    gradeCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    gradeCell.alignment = { horizontal: 'center' };

    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E5EF' } } };
    });
  });

  // Freeze header row, add autofilter
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'M1' };

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [{ header: 'Metric', key: 'metric', width: 28 }, { header: 'Value', key: 'value', width: 20 }];
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B6CF9' } };

  const totalExams = exams.length;
  const uniqueStudents = new Set(exams.map(e => e.student_email)).size;
  const avgScore = totalExams ? Math.round(exams.reduce((sum, e) => sum + (e.total_questions ? (e.score / e.total_questions) * 100 : 0), 0) / totalExams) : 0;

  summarySheet.addRow({ metric: 'Total Exams (filtered)', value: totalExams });
  summarySheet.addRow({ metric: 'Unique Students', value: uniqueStudents });
  summarySheet.addRow({ metric: 'Average Score', value: avgScore + '%' });
  summarySheet.addRow({ metric: 'Exported On', value: new Date().toLocaleString('en-BD') });
  if (level) summarySheet.addRow({ metric: 'Filtered by Level', value: level.toUpperCase() });
  if (stream) summarySheet.addRow({ metric: 'Filtered by Stream', value: stream });
  if (subject) summarySheet.addRow({ metric: 'Filtered by Subject', value: subject });

  const filename = `Parafin_Exam_Results_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
