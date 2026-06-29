# 🎯 PARAFIN - Education Platform

Bangladesh's #1 education platform for SSC & HSC students.

---

## 🚀 QUICK SETUP (5 minutes)

### Step 1 — Install Node.js dependencies
```bash
cd parafin
npm install
```

### Step 2 — Setup MySQL Database
Open phpMyAdmin or MySQL terminal and run:
```sql
SOURCE database.sql;
```
This creates the database, all tables, and seed data.

### Step 3 — Configure Environment
Edit `.env` file:
```
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=parafin_db
SESSION_SECRET=any_random_secret_string
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_gmail_app_password
BASE_URL=http://localhost:3000
```

### Step 4 — Start the server
```bash
npm start
```
Visit: **http://localhost:3000**

---

## 🔑 DEFAULT LOGIN CREDENTIALS

| Role    | Email                    | Password  |
|---------|--------------------------|-----------|
| Admin   | admin@parafin.com        | password  |
| Teacher | teacher@parafin.com      | password  |

> ⚠️ **Change passwords immediately after first login!**
> Update via MySQL: `UPDATE users SET password='[bcrypt_hash]' WHERE email='admin@parafin.com';`

---

## 📁 PROJECT STRUCTURE

```
parafin/
├── server.js              ← Main Express server
├── database.sql           ← MySQL schema + seed data
├── .env                   ← Environment config
├── config/
│   └── db.js              ← MySQL connection pool
├── middleware/
│   └── auth.js            ← Auth & role middleware
├── routes/
│   ├── auth.js            ← Login, Register, Forgot/Reset password
│   ├── student.js         ← Student dashboard, profile, reviews
│   ├── exam.js            ← Exam setup, take, submit, result, history
│   ├── materials.js       ← PDF browse & download
│   ├── courses.js         ← Course listing & purchase
│   ├── admin.js           ← Full admin panel
│   └── teacher.js         ← Teacher question management
├── views/
│   ├── home.ejs           ← Homepage
│   ├── error.ejs          ← Error page
│   ├── partials/
│   │   ├── layout.ejs     ← Navbar + head
│   │   ├── footer.ejs     ← Footer + scripts
│   │   └── sidebar.ejs    ← Dashboard sidebar (admin/teacher/student)
│   ├── auth/              ← Login, Register, Forgot, Reset
│   ├── student/           ← Dashboard, Profile, Setup
│   ├── exam/              ← Setup, Take, Result, History
│   ├── materials/         ← Index, Browse
│   ├── courses/           ← Index, Detail
│   ├── admin/             ← Full admin panel views
│   └── teacher/           ← Teacher panel views
├── public/
│   ├── css/style.css      ← All styles (dark mode, 3D shadows, responsive)
│   └── js/main.js         ← All frontend JS
└── uploads/
    ├── pdfs/              ← Uploaded PDF files
    └── avatars/           ← Team member photos
```

---

## ✨ FEATURES

### 🏠 Homepage
- Bilingual (Bangla / English) toggle
- Dark mode toggle
- Animated hero section with floating cards
- Category cards with 3D box shadow hover effects
- Featured courses section
- Animated marquee student reviews
- Team section with social links
- CTA section

### 👨‍🎓 Students
- Register / Login / Forgot Password / Reset Password
- Stream & level setup (SSC/HSC × Science/Arts/Commerce)
- Dashboard with exam stats
- Browse & download PDF study materials (folder structure)
- Buy courses (bKash/Nagad/Rocket)
- Custom exam setup (choose level, stream, subject, question count, time)
- Live exam with timer, question navigator
- Exam results with correct/wrong answers + explanations
- Report wrong questions with comment
- Exam history
- Submit reviews

### 👨‍🏫 Teachers
- Add MCQ questions (EN + BN, with explanation)
- View question status (pending / approved / rejected)
- Edit & resubmit rejected questions
- See admin comments on rejections
- Set custom exams for students

### 🔧 Admin
- Dashboard overview stats
- Upload & manage PDF materials (any folder/category)
- Manage categories (nested folder structure)
- Approve / Reject / Comment on teacher questions
- Manage courses (add, publish/unpublish, delete)
- Verify course purchases (bKash/Nagad)
- Review question reports from students
- Approve / delete student reviews
- Manage team members (with photos)
- Manage users & change roles

---

## 🎨 DESIGN FEATURES

- **3D Box Shadows**: Cards sit at `-4px` translateY by default (down effect) and jump to `0` on hover
- **Dark Mode**: Full CSS variable system, toggled via button + session
- **Bilingual**: All UI text switches between English and Bangla
- **Responsive**: Mobile-first, hamburger nav, collapsible sidebar
- **Animations**: Marquee reviews, floating cards, fade-in on scroll
- **Font**: Inter (English) + Hind Siliguri (Bangla)

---

## 📧 EMAIL SETUP (Optional for password reset)

1. Enable 2FA on Gmail
2. Generate App Password at myaccount.google.com/apppasswords
3. Add to `.env`:
   ```
   EMAIL_USER=your@gmail.com
   EMAIL_PASS=your_16_char_app_password
   ```

---

## ☁️ CLOUDINARY SETUP (Required for Render / any host with ephemeral disk)

Render (and most free hosting platforms) wipe the local filesystem on every deploy and
restart. Without Cloudinary, any PDF, team photo, or course thumbnail you upload through
the admin panel will disappear the next time the server restarts.

**Setup (5 minutes, free tier is plenty):**
1. Sign up free at https://cloudinary.com
2. From your Cloudinary Dashboard, copy: **Cloud Name**, **API Key**, **API Secret**
3. Add them to `.env` (locally) or your hosting platform's environment variables (Render):
   ```
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```
4. Restart the server. You'll see this in the logs if it's NOT configured:
   ```
   [Parafin] Cloudinary env vars not set — falling back to local disk storage...
   ```
   No warning = Cloudinary is active and uploads will persist.

**If you uploaded files BEFORE adding Cloudinary:** those specific files (e.g. team
photos, a course thumbnail) were saved to local disk and will be lost on the next
restart if they haven't already been. The fix is simple — once Cloudinary is configured,
go to **Admin → Team** and **Admin → Courses**, edit each affected item, and re-upload
the same photo/thumbnail once. It will then be stored on Cloudinary permanently.

Leaving the Cloudinary variables blank is fine for local development — the app
automatically falls back to local disk storage with no code changes needed.

---

## 🛠️ PRODUCTION DEPLOYMENT

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server.js --name parafin

# Auto-restart on reboot
pm2 startup
pm2 save
```

### Deploying on Render + freedb.tech (or any free-tier MySQL host)

- Free MySQL hosts like freedb.tech assign you a **fixed database name** (e.g.
  `freedb_xxxxxxxx`) and usually don't allow `CREATE DATABASE`. When importing
  `database.sql` for the first time, delete the `CREATE DATABASE` / `USE parafin_db`
  lines at the top and select your assigned database first in phpMyAdmin.
- Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` in your environment to
  match the credentials your host gives you.
- Always set the Cloudinary variables above on Render — without them, every uploaded
  file disappears on the next deploy or restart.

For Nginx reverse proxy, point to `http://localhost:3000`.

---

Built with ❤️ in Bangladesh 🇧🇩
