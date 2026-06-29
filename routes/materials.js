const express = require('express');
const router = express.Router();
const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const { isAuthenticated } = require('../middleware/auth');

// Root folder listing — shows top-level folders + search
router.get('/', isAuthenticated, async (req, res) => {
  const { q } = req.query;

  if (q) {
    const [materials] = await db.query(
      `SELECT sm.*, c.name as cat_name FROM study_materials sm
       LEFT JOIN categories c ON c.id=sm.category_id
       WHERE sm.is_approved=1 AND (sm.title LIKE ? OR sm.title_bn LIKE ? OR sm.subject LIKE ?)
       ORDER BY sm.created_at DESC`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );
    const [folders] = await db.query('SELECT * FROM categories WHERE name LIKE ? OR name_bn LIKE ?', [`%${q}%`, `%${q}%`]);
    return res.render('materials/search', { pageTitle: 'Search Materials', materials, folders, query: q });
  }

  const [rootFolders] = await db.query('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY sort_order, name');
  const [rootFiles] = await db.query(
    `SELECT sm.* FROM study_materials sm WHERE sm.category_id IS NULL AND sm.is_approved=1 ORDER BY sm.created_at DESC`
  );

  res.render('materials/index', { pageTitle: 'Study Materials', rootFolders, rootFiles });
});

// Browse a specific folder — shows its subfolders + files
router.get('/browse/:catId', isAuthenticated, async (req, res) => {
  const [cats] = await db.query('SELECT * FROM categories WHERE id=?', [req.params.catId]);
  if (!cats.length) return res.redirect('/materials');
  const cat = cats[0];

  // Build breadcrumb by walking up parent_id
  let breadcrumb = [cat];
  let node = cat;
  while (node.parent_id) {
    const [p] = await db.query('SELECT * FROM categories WHERE id=?', [node.parent_id]);
    if (!p.length) break;
    node = p[0];
    breadcrumb.unshift(node);
  }

  const [subCats] = await db.query('SELECT * FROM categories WHERE parent_id=? ORDER BY sort_order, name', [cat.id]);
  const [materials] = await db.query('SELECT * FROM study_materials WHERE category_id=? AND is_approved=1 ORDER BY year DESC, created_at DESC', [cat.id]);

  res.render('materials/browse', { pageTitle: cat.name, cat, subCats, materials, breadcrumb });
});

router.get('/:id/download', isAuthenticated, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM study_materials WHERE id=? AND is_approved=1', [req.params.id]);
  if (!rows.length) return res.status(404).send('File not found');
  const m = rows[0];
  await db.query('UPDATE study_materials SET download_count=download_count+1 WHERE id=?', [m.id]);

  // Cloudinary-stored files: file_path is a full URL — redirect the browser straight to it.
  if (m.file_path && m.file_path.startsWith('http')) {
    return res.redirect(m.file_path);
  }

  // Legacy local-disk files (uploaded before Cloudinary was wired in, or local dev without Cloudinary)
  const filePath = path.join(__dirname, '..', 'uploads', 'pdfs', m.file_path);
  if (fs.existsSync(filePath)) {
    res.download(filePath, m.title + '.pdf');
  } else {
    req.flash('error', 'File not found on server.');
    res.redirect('/materials');
  }
});

module.exports = router;
