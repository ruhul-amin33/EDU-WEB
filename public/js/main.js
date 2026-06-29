/* =============================================
   PARAFIN — MAIN JS v4.1
   ============================================= */

// ---- THEME ----
const ThemeManager = {
  init() {
    const saved = localStorage.getItem('pf_theme') || 'light';
    this.apply(saved);
  },
  toggle() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    this.apply(next);
    fetch('/settings/theme', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({theme:next}) });
  },
  apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('pf_theme', t);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
  }
};

// ---- LANG ----
const LangManager = {
  toggle(currentLang) {
    const next = currentLang === 'en' ? 'bn' : 'en';
    fetch('/settings/lang', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({lang:next}) })
      .then(() => location.reload())
      .catch(() => location.reload()); // reload anyway so the user isn't stuck if the request fails
  }
};

// ---- OVERLAY & MENUS ----
function getOverlay()  { return document.getElementById('navOverlay'); }
function getNav()      { return document.getElementById('navLinks'); }   // nav-drawer
function getHam()      { return document.getElementById('hamburger'); }
function getSidebar()  { return document.getElementById('sidebar'); }

function showOverlay() {
  const o = getOverlay();
  if (o) { o.style.display = 'block'; setTimeout(() => o.style.opacity = '1', 10); }
  document.body.style.overflow = 'hidden';
}
function hideOverlay() {
  const o = getOverlay();
  if (o) { o.style.opacity = '0'; setTimeout(() => o.style.display = 'none', 250); }
  document.body.style.overflow = '';
}

function openNav() {
  const nav = getNav(), ham = getHam();
  if (nav) nav.classList.add('open');
  if (ham) ham.classList.add('active');
  showOverlay();
}
function closeNav() {
  const nav = getNav(), ham = getHam();
  if (nav) nav.classList.remove('open');
  if (ham) ham.classList.remove('active');
}

function openSidebar() {
  const sb = getSidebar();
  if (sb) sb.classList.add('open');
  showOverlay();
}
function closeSidebar() {
  const sb = getSidebar();
  if (sb) sb.classList.remove('open');
}

// Called by overlay onclick and close button
window.closeAllMenus = function() {
  closeNav();
  closeSidebar();
  hideOverlay();
};

// ---- MOBILE NAV ----
function initMobileNav() {
  const ham = getHam();
  if (ham) {
    ham.addEventListener('click', function(e) {
      e.stopPropagation();
      const nav = getNav();
      if (nav && nav.classList.contains('open')) {
        closeNav(); hideOverlay();
      } else {
        openNav();
      }
    });
  }

  // Sidebar toggle button (dashboard mobile)
  const sbToggle = document.getElementById('sidebarToggle');
  if (sbToggle) {
    sbToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      const sb = getSidebar();
      if (sb && sb.classList.contains('open')) {
        closeSidebar(); hideOverlay();
      } else {
        openSidebar();
      }
    });
  }

  // Close nav when a link is clicked
  const nav = getNav();
  if (nav) {
    nav.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function() {
        closeNav(); hideOverlay();
      });
    });
  }

  // ESC key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeNav(); closeSidebar(); hideOverlay(); }
  });
}

// ---- EXAM TIMER ----
class ExamTimer {
  constructor(seconds, onEnd) {
    this.seconds = seconds; this.onEnd = onEnd;
    this.el = document.getElementById('examTimer'); this.interval = null;
  }
  start() {
    this.render();
    this.interval = setInterval(() => {
      this.seconds--;
      this.render();
      if (this.el && this.seconds <= 60) this.el.classList.add('urgent');
      if (this.seconds <= 0) { clearInterval(this.interval); this.onEnd(); }
    }, 1000);
  }
  render() {
    if (!this.el) return;
    this.el.textContent = String(Math.floor(this.seconds/60)).padStart(2,'0')+':'+String(this.seconds%60).padStart(2,'0');
  }
  stop() { clearInterval(this.interval); }
}

// ---- EXAM UI ----
const ExamUI = {
  current:0, total:0,
  init(total) {
    this.total = total;
    document.querySelectorAll('.question-card').forEach((c,i) => { if(i!==0) c.classList.add('hidden'); });
    this.updateNav();
  },
  go(n) {
    if (n<0||n>=this.total) return;
    document.querySelectorAll('.question-card')[this.current].classList.add('hidden');
    this.current = n;
    document.querySelectorAll('.question-card')[this.current].classList.remove('hidden');
    document.querySelectorAll('.q-nav-btn').forEach((b,i) => b.classList.toggle('active', i===n));
    this.updateNav();
    window.scrollTo({top:0,behavior:'smooth'});
  },
  updateNav() {
    const prev=document.getElementById('prevBtn'), next=document.getElementById('nextBtn'), num=document.getElementById('currentNum');
    if(prev) prev.disabled = this.current===0;
    if(next) next.disabled = this.current===this.total-1;
    if(num)  num.textContent = (this.current+1)+' / '+this.total;
  },
  markAnswered(i) {
    const b = document.querySelector('.q-nav-btn[data-index="'+i+'"]');
    if(b) b.classList.add('answered');
  }
};

// ---- MODAL ----
function openModal(id)  { const e=document.getElementById(id); if(e){e.classList.add('open');document.body.style.overflow='hidden';} }
function closeModal(id) { const e=document.getElementById(id); if(e){e.classList.remove('open');document.body.style.overflow='';} }
document.addEventListener('click', e => { if(e.target.classList.contains('modal-overlay')){e.target.classList.remove('open');document.body.style.overflow='';} });

// ---- FLASH DISMISS ----
function initFlash() {
  document.querySelectorAll('.alert').forEach(el => {
    setTimeout(() => { el.style.opacity='0'; setTimeout(()=>el.remove(),500); }, 4000);
  });
}

// ---- FILE INPUTS ----
function initFileInputs() {
  document.querySelectorAll('input[type="file"]').forEach(inp => {
    inp.addEventListener('change', function() {
      const w=this.closest('.file-input-wrap');
      if(w&&this.files[0]){const l=w.querySelector('.file-name');if(l)l.textContent=this.files[0].name;}
    });
  });
}

// ---- CONFIRM ----
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-confirm]');
  if(!btn) return;
  e.preventDefault();
  if(confirm(btn.dataset.confirm||'Are you sure?')) {
    const f=btn.closest('form'); if(f)f.submit(); else if(btn.href)location.href=btn.href;
  }
});

// ---- PURCHASE ----
function purchaseCourse(id, price) {
  if(price==0){location.href='/courses/'+id+'/enroll';return;}
  openModal('purchaseModal');
  const c=document.getElementById('purchaseCourseId'), a=document.getElementById('purchaseAmount');
  if(c)c.value=id; if(a)a.textContent='৳'+price;
}
function reportQuestion(qid,eid) {
  openModal('reportModal');
  const q=document.getElementById('reportQuestionId'),e=document.getElementById('reportExamId');
  if(q)q.value=qid; if(e)e.value=eid;
}

// ---- ACTIVE NAV ----
function initActiveNav() {
  const path = location.pathname;
  document.querySelectorAll('.nav-links-desktop a, .nav-drawer-links a, .sidebar-link').forEach(a => {
    const h = a.getAttribute('href');
    if (!h) return;
    if (h === path || (h !== '/' && path.startsWith(h))) a.classList.add('active');
  });
}

// ---- SCROLL FADE IN ----
function initScrollAnim() {
  if(!window.IntersectionObserver) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting){ e.target.style.animation='fadeInUp .5s ease forwards'; obs.unobserve(e.target); } });
  }, {threshold:0.08});
  document.querySelectorAll('.feature-card,.action-card,.cat-card,.course-card,.material-card,.team-card').forEach(el => {
    el.style.opacity='0'; obs.observe(el);
  });
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  ThemeManager.init();
  initMobileNav();
  initFlash();
  initFileInputs();
  initActiveNav();
  if(document.querySelector('.hero')) initScrollAnim();
  document.getElementById('themeToggle')?.addEventListener('click', ()=>ThemeManager.toggle());

  const langBtn = document.getElementById('langToggle');
  langBtn?.addEventListener('click', () => LangManager.toggle(langBtn.dataset.currentLang || 'en'));
});

window.openModal=openModal; window.closeModal=closeModal;
window.ExamUI=ExamUI; window.ExamTimer=ExamTimer;
window.purchaseCourse=purchaseCourse; window.reportQuestion=reportQuestion;
