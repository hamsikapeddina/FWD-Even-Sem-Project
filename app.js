/* =============================================================
   WELLNESS TRACK — app.js
   Single-file SPA: Router + DB + Auth + BMI + Charts +
   Dashboard + Diet + Fitness + Goals + Tracker +
   Reminders + Achievements + Profile
   ============================================================= */

/* ─────────────────────────────────────────────────────────────
   ROUTER  — swaps views inside #page-app
───────────────────────────────────────────────────────────── */
const Router = {
  current: null,
  _charts: {},   // store chart instances so we can destroy before redraw

  go(page) {
    // Auth pages
    if (page === 'login' || page === 'register') {
      document.getElementById('page-app').style.display    = 'none';
      document.getElementById('page-login').style.display    = page === 'login'    ? '' : 'none';
      document.getElementById('page-register').style.display = page === 'register' ? '' : 'none';
      this.current = page;
      return;
    }

    // Must be logged in for app pages
    if (!DB.session()) { this.go('login'); return; }

    document.getElementById('page-login').style.display    = 'none';
    document.getElementById('page-register').style.display = 'none';
    document.getElementById('page-app').style.display      = '';

    // Hide all views, show target
    document.querySelectorAll('[id^="view-"]').forEach(el => el.style.display = 'none');
    const view = document.getElementById('view-' + page);
    if (view) { view.style.display = ''; view.classList.remove('fade-in'); void view.offsetWidth; view.classList.add('fade-in'); }

    // Update sidebar active state
    document.querySelectorAll('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });

    // Update header
    App._buildHeader(page);
    App._buildSidebar();

    this.current = page;

    // Run page init
    const inits = {
      dashboard:    () => Dashboard.init(),
      bmi:          () => BMICalc.init(),
      diet:         () => Diet.init(),
      fitness:      () => Fitness.init(),
      goals:        () => Goals.init(),
      tracker:      () => Tracker.init(),
      reminders:    () => Reminders.init(),
      achievements: () => Achievements.init(),
      profile:      () => Profile.init(),
    };
    if (inits[page]) inits[page]();
  },

  destroyChart(id) {
    if (this._charts[id]) { try { this._charts[id].destroy(); } catch(e){} delete this._charts[id]; }
  },

  makeChart(id, config) {
    this.destroyChart(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    this._charts[id] = new Chart(ctx, config);
  }
};

// Sidebar nav clicks
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-link[data-page]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      closeSidebar();
      Router.go(a.dataset.page);
    });
  });

  // Start at login or dashboard
  if (DB.session()) Router.go('dashboard');
  else Router.go('login');

  // Reminder interval
  setInterval(() => App._checkReminders(), 60000);
});

function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}

/* ─────────────────────────────────────────────────────────────
   DB  — localStorage layer
───────────────────────────────────────────────────────────── */
const DB = {
  K_USERS:   'vt_users',   K_SESSION: 'vt_session',
  K_HEALTH:  'vt_health_', K_TRACKER: 'vt_tracker_',
  K_WEIGHTS: 'vt_weights_',K_BMIS:    'vt_bmis_',
  K_REMIND:  'vt_remind_', K_ACHIEVE: 'vt_achieve_',
  K_STREAKS: 'vt_streaks_',

  get(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } },
  set(k,v)    { localStorage.setItem(k, JSON.stringify(v)); },
  getArr(k)   { try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e) { return []; } },

  getUsers()    { return this.getArr(this.K_USERS); },
  saveUsers(u)  { this.set(this.K_USERS, u); },

  register(name, email, password) {
    const users = this.getUsers();
    if (users.find(u => u.email === email)) return { error: 'Email already registered.' };
    users.push({ name, email, password, joined: Date.now() });
    this.saveUsers(users);
    return { ok: true };
  },

  login(email, password) {
    const user = this.getUsers().find(u => u.email === email && u.password === password);
    if (!user) return { error: 'Invalid email or password.' };
    localStorage.setItem(this.K_SESSION, email);
    this.bumpStreak(email, 'login');
    this.unlockAchievement(email, 'first_login');
    return { ok: true, user };
  },

  logout()  { localStorage.removeItem(this.K_SESSION); },

  session() {
    const email = localStorage.getItem(this.K_SESSION);
    if (!email) return null;
    return this.getUsers().find(u => u.email === email) || null;
  },

  updateUser(email, patch) {
    const users = this.getUsers();
    const i = users.findIndex(u => u.email === email);
    if (i < 0) return;
    users[i] = { ...users[i], ...patch };
    this.saveUsers(users);
  },

  getHealth(email)    { return this.get(this.K_HEALTH + email); },
  saveHealth(email, data) {
    const merged = { ...(this.getHealth(email) || {}), ...data, savedAt: Date.now() };
    this.set(this.K_HEALTH + email, merged);
    if (data.weight) this.pushWeight(email, data.weight);
    if (data.bmi)    this.pushBMI(email, data.bmi);
    this.unlockAchievement(email, 'bmi_calc');
  },

  todayKey()  { return new Date().toDateString(); },
  getTracker(email) {
    const all = this.get(this.K_TRACKER + email) || {};
    const t   = this.todayKey();
    if (!all[t]) all[t] = { water:0, exercise:0, steps:0, sleep:0 };
    return { today: all[t], all };
  },
  saveTrackerToday(email, day) {
    const all = this.get(this.K_TRACKER + email) || {};
    all[this.todayKey()] = day;
    this.set(this.K_TRACKER + email, all);
    if (day.water    >= 8)  this.bumpStreak(email, 'water');
    if (day.exercise >= 30) this.bumpStreak(email, 'exercise');
    this.checkTrackerAchievements(email, all);
  },

  getWeights(email)  { return this.getArr(this.K_WEIGHTS + email); },
  getBMIs(email)     { return this.getArr(this.K_BMIS    + email); },

  pushWeight(email, kg) {
    const arr = this.getWeights(email);
    const d   = new Date().toISOString().split('T')[0];
    const i   = arr.findIndex(e => e.d === d);
    if (i >= 0) arr[i].v = +kg; else arr.push({ d, v: +kg });
    this.set(this.K_WEIGHTS + email, arr);
  },
  pushBMI(email, bmi) {
    const arr = this.getBMIs(email);
    const d   = new Date().toISOString().split('T')[0];
    const i   = arr.findIndex(e => e.d === d);
    if (i >= 0) arr[i].v = +bmi; else arr.push({ d, v: +bmi });
    this.set(this.K_BMIS + email, arr);
  },

  getReminders(email)          { return this.getArr(this.K_REMIND + email); },
  saveReminders(email, arr)    { this.set(this.K_REMIND + email, arr); },
  addReminder(email, r) {
    const arr = this.getReminders(email);
    r.id = Date.now(); r.on = true;
    arr.push(r);
    this.saveReminders(email, arr);
    if (arr.length >= 3) this.unlockAchievement(email, 'reminder_pro');
  },
  deleteReminder(email, id)  { this.saveReminders(email, this.getReminders(email).filter(r => r.id !== id)); },
  toggleReminder(email, id)  {
    const arr = this.getReminders(email);
    const r   = arr.find(r => r.id === id);
    if (r) r.on = !r.on;
    this.saveReminders(email, arr);
  },

  ACHIEVEMENTS: [
    { id:'first_login',  icon:'🎉', name:'First Step',       desc:'Logged in for the first time' },
    { id:'bmi_calc',     icon:'📏', name:'Health Aware',     desc:'Calculated your BMI' },
    { id:'hydration_7',  icon:'💧', name:'Hydration Master', desc:'Hit water goal 7 days' },
    { id:'workout_5',    icon:'🏋️', name:'Fitness Starter',  desc:'Logged exercise 5 days' },
    { id:'login_7',      icon:'🔥', name:'Consistency Hero', desc:'7-day login streak' },
    { id:'goal_achieved',icon:'🎯', name:'Goal Achiever',    desc:'Reached target BMI' },
    { id:'sleep_5',      icon:'😴', name:'Sleep Champion',   desc:'Slept 8h for 5 nights' },
    { id:'steps_10k',    icon:'👟', name:'Step Master',      desc:'10,000 steps in a day' },
    { id:'tracker_10',   icon:'📋', name:'Tracker Pro',      desc:'Used tracker 10 days' },
    { id:'weight_log_5', icon:'⚖️', name:'Weight Watcher',   desc:'Logged weight 5 times' },
    { id:'reminder_pro', icon:'⏰', name:'Reminder Pro',     desc:'Set 3+ reminders' },
    { id:'profile_done', icon:'👤', name:'Profile Complete', desc:'Filled out your profile' },
  ],

  getAchievements(email) {
    const saved = this.get(this.K_ACHIEVE + email);
    if (saved) return saved;
    const fresh = this.ACHIEVEMENTS.map(a => ({ ...a, earned:false, earnedAt:null }));
    this.set(this.K_ACHIEVE + email, fresh);
    return fresh;
  },
  unlockAchievement(email, id) {
    const arr = this.getAchievements(email);
    const a   = arr.find(x => x.id === id);
    if (a && !a.earned) { a.earned = true; a.earnedAt = Date.now(); this.set(this.K_ACHIEVE + email, arr); return a; }
    return null;
  },
  checkTrackerAchievements(email, all) {
    const days = Object.values(all);
    if (days.filter(d => d.water    >= 8).length >= 7)  this.unlockAchievement(email, 'hydration_7');
    if (days.filter(d => d.exercise >  0).length >= 5)  this.unlockAchievement(email, 'workout_5');
    if (days.filter(d => d.sleep    >= 8).length >= 5)  this.unlockAchievement(email, 'sleep_5');
    if (days.filter(d => d.steps >= 10000).length >= 1) this.unlockAchievement(email, 'steps_10k');
    if (Object.keys(all).length >= 10)                  this.unlockAchievement(email, 'tracker_10');
    if (this.getWeights(email).length >= 5)             this.unlockAchievement(email, 'weight_log_5');
  },

  getStreaks(email) {
    return this.get(this.K_STREAKS + email) || { login:0, water:0, exercise:0, loginLast:'', waterLast:'', exerciseLast:'' };
  },
  bumpStreak(email, type) {
    const s         = this.getStreaks(email);
    const today     = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const lastKey   = type + 'Last';
    if (s[lastKey] === today) return;
    s[type]   = (s[lastKey] === yesterday) ? (s[type] || 0) + 1 : 1;
    s[lastKey] = today;
    this.set(this.K_STREAKS + email, s);
    if (s.login >= 7) this.unlockAchievement(email, 'login_7');
  },

  weeklyActivity(email) {
    const all = this.getTracker(email).all;
    return Array.from({ length:7 }, (_,i) => {
      const d   = new Date(Date.now() - (6-i)*86400000);
      const key = d.toDateString();
      return { day: d.toLocaleDateString('en', { weekday:'short' }), exercise:(all[key]||{}).exercise||0, steps:(all[key]||{}).steps||0 };
    });
  },

  export(email) {
    return { user:this.session(), health:this.getHealth(email), tracker:this.getTracker(email).all,
      weights:this.getWeights(email), bmis:this.getBMIs(email), reminders:this.getReminders(email),
      achievements:this.getAchievements(email), streaks:this.getStreaks(email), at:new Date().toISOString() };
  },

  fmtDate(iso) { return new Date(iso).toLocaleDateString('en', { month:'short', day:'numeric' }); }
};

/* ─────────────────────────────────────────────────────────────
   AUTH
───────────────────────────────────────────────────────────── */
const Auth = {
  doLogin() {
    const email = document.getElementById('lemail').value.trim();
    const pass  = document.getElementById('lpass').value;
    const err   = document.getElementById('lerr');
    const res   = DB.login(email, pass);
    if (res.error) { err.textContent = res.error; err.classList.add('show'); }
    else { err.classList.remove('show'); Router.go('dashboard'); }
  },
  doRegister() {
    const name  = document.getElementById('rname').value.trim();
    const email = document.getElementById('remail').value.trim();
    const pass  = document.getElementById('rpass').value;
    const pass2 = document.getElementById('rpass2').value;
    const err   = document.getElementById('rerr');
    const ok    = document.getElementById('rok');
    if (pass !== pass2)  { err.textContent = 'Passwords do not match.'; err.classList.add('show'); return; }
    if (pass.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.classList.add('show'); return; }
    const res = DB.register(name, email, pass);
    if (res.error) { err.textContent = res.error; err.classList.add('show'); ok.classList.remove('show'); }
    else { err.classList.remove('show'); ok.classList.add('show'); setTimeout(() => Router.go('login'), 1400); }
  },
  logout() { DB.logout(); Router.go('login'); }
};

// Allow pressing Enter in login fields
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && Router.current === 'login')    Auth.doLogin();
  if (e.key === 'Enter' && Router.current === 'register') Auth.doRegister();
});

/* ─────────────────────────────────────────────────────────────
   APP SHELL
───────────────────────────────────────────────────────────── */
const App = {
  _buildSidebar() {
    const user = DB.session(); if (!user) return;
    const initials = user.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
    const ava  = document.getElementById('sidebarAva');
    const name = document.getElementById('sidebarName');
    if (ava)  ava.textContent  = initials;
    if (name) name.textContent = user.name.split(' ')[0];
  },

  _buildHeader(page) {
    const el   = document.getElementById('appHeader'); if (!el) return;
    const user = DB.session(); if (!user) return;
    const initials = user.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
    const labels = { dashboard:'Dashboard', bmi:'BMI & Health', diet:'Diet Plan', fitness:'Fitness Plan',
      goals:'Goals', tracker:'Daily Tracker', reminders:'Reminders', achievements:'Achievements', profile:'Profile' };
    el.innerHTML = `
      <button class="hamburger" id="hamburger"><span></span><span></span><span></span></button>
      <div><div class="header-title">Wellness Track <span class="header-sub">${labels[page]||page}</span></div></div>
      <div class="header-right">
        <span class="header-name">${user.name}</span>
        <div class="header-ava" onclick="Auth.logout()" title="Logout">${initials}</div>
      </div>`;
    document.getElementById('hamburger')?.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('open');
      document.getElementById('sidebarOverlay')?.classList.toggle('show');
    });
  },

  _checkReminders() {
    const user = DB.session(); if (!user) return;
    const now  = new Date();
    const cur  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    DB.getReminders(user.email).filter(r=>r.on).forEach(r => {
      if (r.time === cur) App.toast(`⏰ Reminder: ${r.label}`, 'info');
    });
  },

  toast(msg, type='success', ms=3400) {
    let box = document.getElementById('toastBox');
    if (!box) { box = document.createElement('div'); box.id='toastBox'; box.className='toast-box'; document.body.appendChild(box); }
    const icons = { success:'✅', error:'❌', info:'ℹ️' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type]||'🔔'}</span><span style="flex:1">${msg}</span><span style="cursor:pointer;color:#94a3b8" onclick="this.parentElement.remove()">×</span>`;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  },

  alerts(health, today) {
    const list = [];
    if (!health) { list.push({ cls:'info', icon:'📏', title:'Set up your health profile', msg:'Go to BMI & Health to enter your details.' }); return list; }
    if (health.bmi < 18.5) list.push({ cls:'warn',   icon:'⚠️', title:'Underweight BMI', msg:`Your BMI of ${health.bmi} is below the healthy range.` });
    if (health.bmi >= 30)  list.push({ cls:'danger', icon:'🔴', title:'High BMI',         msg:`BMI ${health.bmi} indicates obesity. Diet and exercise are key.` });
    if (today?.water    <  4)  list.push({ cls:'warn', icon:'💧', title:'Low water intake', msg:'Fewer than 4 glasses logged today.' });
    if (today?.exercise < 20)  list.push({ cls:'warn', icon:'🏃', title:'Low activity',    msg:'Less than 20 minutes of exercise logged today.' });
    if (!list.length) list.push({ cls:'good', icon:'✨', title:'All looks great!', msg:'Your metrics are on track. Keep going!' });
    return list;
  },

  scoreCalc(health, today) {
    if (!health) return 0;
    let s = 0;
    const bmi = health.bmi;
    if (bmi >= 18.5 && bmi < 25) s += 30; else if (bmi >= 17 && bmi < 30) s += 15;
    if (today) {
      s += Math.min(25, Math.round((today.water    / 8)  * 25));
      s += Math.min(25, Math.round((today.exercise / 60) * 25));
      s += Math.min(20, Math.round((today.sleep    / 8)  * 20));
    }
    return Math.min(100, s);
  }
};

/* ─────────────────────────────────────────────────────────────
   HEIGHT TOGGLE (BMI page)
───────────────────────────────────────────────────────────── */
const HeightToggle = {
  mode: 'cm',
  setCm() {
    this.mode = 'cm';
    document.getElementById('heightCm').style.display = '';
    document.getElementById('heightFt').style.display = 'none';
    document.getElementById('btnCm').style.cssText = 'padding:2px 8px;background:var(--primary);color:#fff;border:none;cursor:pointer;font-size:0.7rem;font-weight:600';
    document.getElementById('btnFt').style.cssText = 'padding:2px 8px;background:#fff;color:var(--text-muted);border:none;cursor:pointer;font-size:0.7rem;font-weight:600';
  },
  setFt() {
    this.mode = 'ft';
    document.getElementById('heightCm').style.display = 'none';
    document.getElementById('heightFt').style.display = '';
    document.getElementById('btnFt').style.cssText = 'padding:2px 8px;background:var(--primary);color:#fff;border:none;cursor:pointer;font-size:0.7rem;font-weight:600';
    document.getElementById('btnCm').style.cssText = 'padding:2px 8px;background:#fff;color:var(--text-muted);border:none;cursor:pointer;font-size:0.7rem;font-weight:600';
  },
  getHeightCm() {
    if (this.mode === 'cm') return +document.getElementById('height').value;
    const ft = +document.getElementById('heightFeet').value || 0;
    const inches = +document.getElementById('heightInches').value || 0;
    return Math.round(ft * 30.48 + inches * 2.54);
  }
};

/* ─────────────────────────────────────────────────────────────
   BMI CALC
───────────────────────────────────────────────────────────── */
const BMICalc = {
  calc(w,h)  { const hm=h/100; return +(w/(hm*hm)).toFixed(1); },
  category(bmi) {
    if (bmi<18.5) return { label:'Underweight', color:'#3b82f6' };
    if (bmi<25)   return { label:'Normal',      color:'#22c55e' };
    if (bmi<30)   return { label:'Overweight',  color:'#f59e0b' };
    return              { label:'Obese',        color:'#ef4444' };
  },
  idealWeight(h,g) { const hh=h-100; return g==='male' ? Math.round(hh*0.9) : Math.round(hh*0.85); },
  bmr(w,h,a,g)  { const b=10*w+6.25*h-5*a; return Math.round(g==='male'?b+5:b-161); },
  ACTIVITY: { sedentary:1.2, lightly:1.375, moderately:1.55, active:1.725, very_active:1.9 },
  tdee(bmr,act) { return Math.round(bmr*(this.ACTIVITY[act]||1.55)); },
  goalCalories(tdee,goal) { if(goal==='lose') return tdee-500; if(goal==='gain') return tdee+300; return tdee; },
  macros(cal,goal) {
    const r = goal==='lose'?{p:.35,c:.35,f:.30}:goal==='gain'?{p:.30,c:.45,f:.25}:{p:.30,c:.40,f:.30};
    return { protein:Math.round(cal*r.p/4), carbs:Math.round(cal*r.c/4), fat:Math.round(cal*r.f/9),
      pPct:Math.round(r.p*100), cPct:Math.round(r.c*100), fPct:Math.round(r.f*100) };
  },
  waterLitres(w) { return +(w*0.033).toFixed(1); },
  scalePos(bmi)  { return Math.max(1,Math.min(99,((bmi-15)/25)*100)); },
  healthScore(bmi,mood,act) {
    let s=0;
    if(bmi>=18.5&&bmi<25)s+=40; else if(bmi>=17&&bmi<30)s+=20;
    s += ({very_low:5,low:10,neutral:15,good:25,excellent:30}[mood]||15);
    s += ({sedentary:5,lightly:15,moderately:20,active:25,very_active:30}[act]||20);
    return Math.min(100,s);
  },

  init() {
    const u=DB.session(); if(!u) return;
    const saved=DB.getHealth(u.email);
    if(saved) { this._fillForm(saved); this._renderResults(saved); }
  },

  _fillForm(d) {
    ['age','gender','height','weight','activity','goal','mood'].forEach(id => {
      const el=document.getElementById(id); if(el&&d[id]!=null) el.value=d[id];
    });
  },

  _calculate() {
    const u=DB.session(); if(!u) return;
    if(HeightToggle.mode==='ft') {
      const cm=HeightToggle.getHeightCm();
      if(!cm) { App.toast('Please enter a valid height.','error'); return; }
      document.getElementById('height').value=cm;
    }
    const age      = +document.getElementById('age').value;
    const gender   = document.getElementById('gender').value;
    const height   = +document.getElementById('height').value;
    const weight   = +document.getElementById('weight').value;
    const activity = document.getElementById('activity').value;
    const goal     = document.getElementById('goal').value;
    const mood     = document.getElementById('mood').value;
    if(!age||!height||!weight) { App.toast('Please fill all fields.','error'); return; }

    const bmi      = this.calc(weight,height);
    const bmrVal   = this.bmr(weight,height,age,gender);
    const tdeeVal  = this.tdee(bmrVal,activity);
    const calories = this.goalCalories(tdeeVal,goal);
    const macroObj = this.macros(calories,goal);
    const ideal    = this.idealWeight(height,gender);
    const water    = this.waterLitres(weight);
    const score    = this.healthScore(bmi,mood,activity);
    const data     = { age,gender,height,weight,activity,goal,mood,bmi,bmrVal,tdeeVal,calories,macros:macroObj,ideal,water,score,
      initialBMI: DB.getHealth(u.email)?.initialBMI || bmi };
    DB.saveHealth(u.email,data);
    this._renderResults(data);
    App.toast('Health data saved! ✅','success');
    document.getElementById('resultsCard').scrollIntoView({ behavior:'smooth' });
  },

  _renderResults(d) {
    const r=document.getElementById('resultsCard'); if(!r||!d.bmi) return;
    r.style.display='block';
    const cat=this.category(d.bmi);
    const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
    set('rBMI',d.bmi);  document.getElementById('rBMI').style.color=cat.color;
    set('rCat',cat.label); document.getElementById('rCat').style.color=cat.color;
    const marker=document.getElementById('bmiMarker');
    if(marker) setTimeout(()=>marker.style.left=this.scalePos(d.bmi)+'%',80);
    set('rIdeal',   d.ideal+' kg');
    set('rCalories',(d.calories||0).toLocaleString()+' kcal');
    set('rBMR',     (d.bmrVal||0).toLocaleString()+' kcal');
    set('rWater',   d.water+' L/day');
    set('rProtein', (d.macros?.protein||0)+'g');
    set('rCarbs',   (d.macros?.carbs||0)+'g');
    set('rFat',     (d.macros?.fat||0)+'g');
    set('rScore',   d.score);
  }
};

/* ─────────────────────────────────────────────────────────────
   CHARTS
───────────────────────────────────────────────────────────── */
const Charts = {
  _opts(extra={}) {
    return { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#64748b', font:{family:'Inter,sans-serif',size:11}, boxWidth:10, boxHeight:10 } },
        tooltip:{ backgroundColor:'#1e293b', titleColor:'#f1f5f9', bodyColor:'#94a3b8', borderColor:'#334155', borderWidth:1, padding:10, cornerRadius:8 } },
      scales:{ x:{ grid:{color:'#f1f5f9',drawBorder:false}, ticks:{color:'#94a3b8',font:{size:11}}, border:{display:false} },
               y:{ grid:{color:'#f1f5f9',drawBorder:false}, ticks:{color:'#94a3b8',font:{size:11}}, border:{display:false} } }, ...extra };
  },
  _noScale(extra={}) {
    return { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#64748b', font:{family:'Inter,sans-serif',size:11}, boxWidth:10, boxHeight:10 } },
        tooltip:{ backgroundColor:'#1e293b', titleColor:'#f1f5f9', bodyColor:'#94a3b8', borderColor:'#334155', borderWidth:1, padding:10, cornerRadius:8 } }, ...extra };
  },
  bmiHistory(canvasId,email) {
    const data=DB.getBMIs(email);
    Router.makeChart(canvasId, { type:'line', data:{ labels:data.length?data.map(e=>DB.fmtDate(e.d)):['Now'],
      datasets:[{ label:'BMI', data:data.length?data.map(e=>e.v):[0], borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,0.08)', tension:0.4, fill:true, pointBackgroundColor:'#22c55e', pointRadius:4 }] }, options:this._opts() });
  },
  weightHistory(canvasId,email) {
    const data=DB.getWeights(email);
    Router.makeChart(canvasId, { type:'line', data:{ labels:data.length?data.map(e=>DB.fmtDate(e.d)):['Now'],
      datasets:[{ label:'Weight (kg)', data:data.length?data.map(e=>e.v):[0], borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)', tension:0.4, fill:true, pointBackgroundColor:'#3b82f6', pointRadius:4 }] }, options:this._opts() });
  },
  macros(canvasId,macros) {
    if(!macros) return;
    Router.makeChart(canvasId, { type:'doughnut', data:{ labels:['Protein','Carbs','Fat'],
      datasets:[{ data:[macros.protein,macros.carbs,macros.fat], backgroundColor:['#22c55e','#3b82f6','#f59e0b'], borderColor:'transparent', hoverOffset:6 }] },
      options:this._noScale({ cutout:'68%', plugins:{ ...this._noScale().plugins, legend:{ position:'bottom', labels:{...this._noScale().plugins.legend.labels,padding:14} } } }) });
  },
  weeklyActivity(canvasId,email) {
    const data=DB.weeklyActivity(email);
    Router.makeChart(canvasId, { type:'bar', data:{ labels:data.map(d=>d.day),
      datasets:[
        { label:'Exercise (min)', data:data.map(d=>d.exercise), backgroundColor:'rgba(34,197,94,0.75)', borderRadius:5, borderSkipped:false },
        { label:'Steps ÷100',    data:data.map(d=>Math.round(d.steps/100)), backgroundColor:'rgba(59,130,246,0.6)', borderRadius:5, borderSkipped:false }
      ] }, options:this._opts() });
  },
  workoutDist(canvasId,cardio,strength,rest) {
    Router.makeChart(canvasId, { type:'doughnut', data:{ labels:['Cardio','Strength','Rest'],
      datasets:[{ data:[cardio,strength,rest], backgroundColor:['#3b82f6','#ec4899','#94a3b8'], borderColor:'transparent', hoverOffset:5 }] },
      options:this._noScale({ cutout:'62%', plugins:{ ...this._noScale().plugins, legend:{ position:'bottom', labels:{...this._noScale().plugins.legend.labels,padding:12} } } }) });
  }
};

/* ─────────────────────────────────────────────────────────────
   DASHBOARD
───────────────────────────────────────────────────────────── */
const Dashboard = {
  init() {
    const user=DB.session(); if(!user) return;
    const health=DB.getHealth(user.email);
    const tracker=DB.getTracker(user.email);
    const streaks=DB.getStreaks(user.email);
    this._welcome(user,health);
    this._stats(health,tracker.today);
    this._streaks(streaks);
    this._score(health,tracker.today);
    this._alerts(health,tracker.today);
    this._quickTracker(user.email,tracker.today);
    this._weights(user.email);
    setTimeout(()=>{
      Charts.bmiHistory('cBMI',user.email);
      Charts.weightHistory('cWeight',user.email);
      Charts.weeklyActivity('cActivity',user.email);
      if(health?.macros) Charts.macros('cMacro',health.macros);
    },50);
  },
  _welcome(user,health) {
    const hr=new Date().getHours();
    const greet=hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
    const el=document.getElementById('welcomeMsg');
    if(el) el.innerHTML=`${greet}, <span style="color:var(--primary)">${user.name.split(' ')[0]}</span> 👋`;
    const sub=document.getElementById('welcomeSub');
    if(sub) sub.textContent=health?`BMI ${health.bmi} · ${health.goal==='lose'?'Weight Loss':health.goal==='gain'?'Muscle Gain':'Maintenance'} Mode`:'Complete your health profile to get started';
  },
  _stats(h,today) {
    const s=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
    s('sBMI',     h?.bmi||'—');
    s('sBMICat',  h?BMICalc.category(h.bmi).label:'Not set');
    s('sWeight',  h?.weight?h.weight+' kg':'—');
    s('sCalories',h?.calories?h.calories.toLocaleString():'—');
    s('sWater',   `${today?.water||0}/8`);
    s('sExercise',`${today?.exercise||0} min`);
    s('sSteps',   (today?.steps||0).toLocaleString());
    s('sMood',    h?.mood?h.mood.replace('_',' '):'—');
  },
  _streaks(streaks) {
    const el=document.getElementById('streakRow'); if(!el) return;
    const items=[{icon:'🔥',label:'Login',n:streaks.login||0},{icon:'💧',label:'Hydration',n:streaks.water||0},{icon:'🏃',label:'Exercise',n:streaks.exercise||0}];
    el.innerHTML=items.map(s=>`<div class="streak-pill${s.n>0?' on':''}">${s.icon} ${s.label} <strong>${s.n}d</strong></div>`).join('');
  },
  _score(health,today) {
    const score=App.scoreCalc(health,today);
    const el=document.getElementById('scoreNum'); if(el) el.textContent=score;
    const ring=document.getElementById('scoreRingCircle');
    if(ring){ const c=2*Math.PI*45; setTimeout(()=>{ ring.style.strokeDasharray=c; ring.style.strokeDashoffset=c-(score/100)*c; },100); }
    const details=document.getElementById('scoreItems');
    if(details&&health){ const rows=[{label:'BMI Status',val:BMICalc.category(health.bmi).label},{label:'Daily Water',val:today?`${today.water}/8 glasses`:'—'},{label:'Exercise',val:today?`${today.exercise} min`:'—'},{label:'Sleep',val:today?`${today.sleep} hrs`:'—'}];
      details.innerHTML=rows.map(r=>`<div class="score-item"><span class="score-item-label">${r.label}</span><span class="score-item-val">${r.val}</span></div>`).join(''); }
  },
  _alerts(health,today) {
    const el=document.getElementById('alertsWrap'); if(!el) return;
    el.innerHTML=App.alerts(health,today).map(a=>`<div class="health-alert ${a.cls}"><span class="ha-icon">${a.icon}</span><div class="ha-text"><strong>${a.title}</strong>${a.msg}</div></div>`).join('');
  },
  _quickTracker(email,today) {
    const items=[{key:'water',emoji:'💧',label:'Water',unit:'glasses',max:8,goal:8,step:1,color:'blue'},{key:'exercise',emoji:'🏃',label:'Exercise',unit:'min',max:120,goal:60,step:1,color:'green'},{key:'steps',emoji:'👟',label:'Steps',unit:'',max:15000,goal:10000,step:500,color:'orange'},{key:'sleep',emoji:'😴',label:'Sleep',unit:'hrs',max:10,goal:8,step:0.5,color:'purple'}];
    window._trackerData={...today};
    const render=()=>{
      const el=document.getElementById('quickTracker'); if(!el) return;
      el.innerHTML=items.map(it=>{ const v=window._trackerData[it.key]||0; const pct=Math.min(100,Math.round((v/it.goal)*100));
        return `<div class="tracker-item"><span class="tracker-emoji">${it.emoji}</span><div class="tracker-info"><div class="tracker-name">${it.label}</div><div class="prog-bar sm"><div class="prog-fill ${it.color}" style="width:${pct}%"></div></div></div><div class="tracker-ctrls"><button class="ctrl-btn" onclick="Dashboard._adj('${email}','${it.key}',-${it.step},${it.max})">−</button><span class="ctrl-count">${it.unit?v+' '+it.unit:v.toLocaleString()}</span><button class="ctrl-btn" onclick="Dashboard._adj('${email}','${it.key}',${it.step},${it.max})">+</button></div></div>`; }).join('');
    };
    render();
  },
  _adj(email,key,delta,max) {
    window._trackerData[key]=Math.max(0,Math.min(max,(window._trackerData[key]||0)+delta));
    DB.saveTrackerToday(email,window._trackerData);
    this._quickTracker(email,window._trackerData);
    this._stats(DB.getHealth(email),window._trackerData);
    this._score(DB.getHealth(email),window._trackerData);
  },
  _weights(email) {
    const el=document.getElementById('weightList'); if(!el) return;
    const hist=DB.getWeights(email).slice().reverse().slice(0,6);
    if(!hist.length){ el.innerHTML='<div class="empty-state"><div class="empty-icon">⚖️</div><p>No weight logs yet. Save data on the <a href="#" onclick="Router.go(\'bmi\')">BMI page</a>.</p></div>'; return; }
    el.innerHTML=hist.map((e,i)=>{ const prev=hist[i+1]; const diff=prev?(e.v-prev.v).toFixed(1):null;
      return `<div class="w-entry"><span class="w-date">${DB.fmtDate(e.d)}</span><span class="w-val">${e.v} kg</span>${diff!==null?`<span class="w-change ${+diff>0?'w-up':'w-down'}">${+diff>0?'+':''}${diff} kg</span>`:'<span class="w-change" style="color:#94a3b8">baseline</span>'}</div>`; }).join('');
  }
};

/* ─────────────────────────────────────────────────────────────
   DIET
───────────────────────────────────────────────────────────── */
const Diet = {
  MEALS: {
    lose:{
      breakfast:[{name:'Moong Dal Cheela',desc:'Green moong crepes with mint chutney & low-fat curd',cal:260,pro:'14g',carb:'32g',fat:'6g'},{name:'Poha with Vegetables',desc:'Flattened rice with peas, carrot, curry leaves & lemon',cal:240,pro:'6g',carb:'42g',fat:'5g'}],
      lunch:[{name:'Tandoori Chicken + Salad',desc:'Grilled tandoori chicken, cucumber-onion salad, 1 roti',cal:380,pro:'40g',carb:'22g',fat:'12g'},{name:'Dal + Brown Rice + Sabzi',desc:'Masoor dal, steamed brown rice, bottle gourd sabzi',cal:360,pro:'18g',carb:'55g',fat:'7g'}],
      dinner:[{name:'Palak Paneer + Roti',desc:'Spinach-paneer curry (low oil), 2 whole wheat rotis',cal:420,pro:'22g',carb:'38g',fat:'16g'},{name:'Grilled Fish + Dal',desc:'Rohu / surmai grilled, yellow dal, steamed veggies',cal:390,pro:'38g',carb:'28g',fat:'10g'}],
      snacks:[{name:'Sprouts Chaat',desc:'Mixed sprouts, lemon, chaat masala, onion, tomato',cal:150,pro:'9g',carb:'22g',fat:'2g'}]
    },
    gain:{
      breakfast:[{name:'Paneer Paratha + Lassi',desc:'Stuffed paneer paratha with full-fat lassi & pickle',cal:580,pro:'26g',carb:'60g',fat:'22g'},{name:'Anda Bhurji + Paratha',desc:'4-egg bhurji with butter paratha & chai',cal:620,pro:'32g',carb:'55g',fat:'24g'}],
      lunch:[{name:'Chicken Curry + Rice + Dal',desc:'Desi chicken curry, white rice, chana dal, salad',cal:720,pro:'48g',carb:'68g',fat:'22g'},{name:'Rajma Chawal + Curd',desc:'Kidney bean curry, basmati rice, full-fat curd',cal:680,pro:'28g',carb:'82g',fat:'14g'}],
      dinner:[{name:'Mutton Rogan Josh + Naan',desc:'Slow-cooked mutton curry, butter naan, onion raita',cal:780,pro:'52g',carb:'50g',fat:'30g'},{name:'Paneer Butter Masala + Rice',desc:'Rich paneer gravy, steamed rice, papad',cal:700,pro:'30g',carb:'72g',fat:'28g'}],
      snacks:[{name:'Banana + Peanut Chikki',desc:'2 bananas with groundnut chikki & milk',cal:340,pro:'10g',carb:'52g',fat:'10g'},{name:'Dahi + Dry Fruits',desc:'Full-fat curd with almonds, cashews & raisins',cal:300,pro:'12g',carb:'28g',fat:'16g'}]
    },
    maintain:{
      breakfast:[{name:'Idli Sambar + Coconut Chutney',desc:'3 steamed idlis with sambar & fresh coconut chutney',cal:320,pro:'10g',carb:'56g',fat:'6g'},{name:'Masala Oats Upma',desc:'Rolled oats with mustard, curry leaves, veggies & peanuts',cal:300,pro:'9g',carb:'48g',fat:'8g'}],
      lunch:[{name:'Thali — Dal, Sabzi, Rice, Roti',desc:'Toor dal, mixed veg sabzi, rice, 2 rotis, salad',cal:520,pro:'20g',carb:'80g',fat:'12g'},{name:'Chole + Bhatura (light)',desc:'Spiced chickpeas, 1 small bhatura, onion salad',cal:480,pro:'18g',carb:'72g',fat:'14g'}],
      dinner:[{name:'Khichdi + Ghee + Papad',desc:'Moong dal khichdi with a tsp of ghee & roasted papad',cal:400,pro:'16g',carb:'60g',fat:'10g'},{name:'Chicken Roti Roll',desc:'Grilled chicken tikka, whole wheat roti, mint chutney',cal:440,pro:'36g',carb:'42g',fat:'12g'}],
      snacks:[{name:'Roasted Makhana + Chai',desc:'Fox nuts roasted in ghee with masala chai',cal:180,pro:'5g',carb:'28g',fat:'5g'}]
    }
  },
  MOOD_ADVICE:{very_low:'💙 Hard day? Try magnesium-rich foods (dark chocolate, nuts, leafy greens) and omega-3s.',low:'🌿 Boost serotonin with tryptophan-rich foods: turkey, eggs, cheese. Avoid processed sugar.',neutral:'⚖️ Focus on balanced macros. Keep meals regular to maintain steady energy.',good:'✨ Great energy! A slightly higher-carb window around your workout will fuel performance.',excellent:'🚀 Top form! Prioritize protein and complex carbs today.'},
  init() {
    const user=DB.session(); if(!user) return;
    const health=DB.getHealth(user.email);
    this._render(health);
    setTimeout(()=>{ if(health?.macros) Charts.macros('cDietMacro',health.macros); },50);
  },
  _render(h) {
    const el=document.getElementById('dietWrap'); if(!el) return;
    if(!h){ el.innerHTML=`<div class="card"><div class="empty-state"><div class="empty-icon">🥗</div><p>Complete your <a href="#" onclick="Router.go('bmi')">BMI profile</a> first.</p></div></div>`; return; }
    const plan=this.MEALS[h.goal]||this.MEALS.maintain;
    const advice=this.MOOD_ADVICE[h.mood]||this.MOOD_ADVICE.neutral;
    const sections=[{key:'breakfast',icon:'🌅',label:'Breakfast'},{key:'lunch',icon:'☀️',label:'Lunch'},{key:'dinner',icon:'🌙',label:'Dinner'},{key:'snacks',icon:'🍎',label:'Snacks'}];
    el.innerHTML=`
      <div class="g4 mb-20 stagger">
        <div class="stat-card"><div class="accent-bar" style="background:var(--primary)"></div><div class="stat-label">Daily Calories</div><div class="stat-value" style="color:var(--primary)">${h.calories?.toLocaleString()}</div><div class="stat-meta">kcal target</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:#3b82f6"></div><div class="stat-label">Protein</div><div class="stat-value" style="color:#3b82f6">${h.macros?.protein}g</div><div class="stat-meta">per day</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:#f59e0b"></div><div class="stat-label">Carbs</div><div class="stat-value" style="color:#f59e0b">${h.macros?.carbs}g</div><div class="stat-meta">per day</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:#ec4899"></div><div class="stat-label">Fat</div><div class="stat-value" style="color:#ec4899">${h.macros?.fat}g</div><div class="stat-meta">per day</div></div>
      </div>
      <div class="g23 mb-20">
        <div class="card"><div class="card-title">📊 Macro Distribution</div><div class="chart-wrap h250"><canvas id="cDietMacro"></canvas></div></div>
        <div class="card"><div class="card-title mb-16">🧠 Mood-Based Advice</div><div class="health-alert info"><span class="ha-icon">💡</span><div class="ha-text"><strong>Today's Tip</strong>${advice}</div></div>
          <div style="margin-top:16px">
            <div class="prog-row"><div class="prog-header"><span class="prog-label">Protein</span><span class="prog-val" style="color:#22c55e">${h.macros?.pPct}%</span></div><div class="prog-bar"><div class="prog-fill green" style="width:${h.macros?.pPct}%"></div></div></div>
            <div class="prog-row"><div class="prog-header"><span class="prog-label">Carbohydrates</span><span class="prog-val" style="color:#3b82f6">${h.macros?.cPct}%</span></div><div class="prog-bar"><div class="prog-fill blue" style="width:${h.macros?.cPct}%"></div></div></div>
            <div class="prog-row"><div class="prog-header"><span class="prog-label">Healthy Fats</span><span class="prog-val" style="color:#f59e0b">${h.macros?.fPct}%</span></div><div class="prog-bar"><div class="prog-fill orange" style="width:${h.macros?.fPct}%"></div></div></div>
          </div>
        </div>
      </div>
      <div class="card"><div class="card-title mb-16">🍽️ Personalised Meal Plan <span class="chip chip-${h.goal==='lose'?'blue':h.goal==='gain'?'green':'orange'}" style="margin-left:8px">${h.goal==='lose'?'Weight Loss':h.goal==='gain'?'Muscle Gain':'Maintenance'}</span></div>
        <div class="g2">${sections.map(s=>`<div><div style="font-weight:700;font-size:0.82rem;color:var(--text-muted);margin-bottom:10px">${s.icon} ${s.label}</div>${(plan[s.key]||[]).map(m=>`<div class="meal-card"><div class="meal-time">${s.label}</div><div class="meal-name">${m.name}</div><div class="meal-desc">${m.desc}</div><div class="meal-tags"><span class="meal-tag tag-cal">🔥 ${m.cal} kcal</span><span class="meal-tag tag-pro">P: ${m.pro}</span><span class="meal-tag tag-carb">C: ${m.carb}</span><span class="meal-tag tag-fat">F: ${m.fat}</span></div></div>`).join('')}</div>`).join('')}</div>
      </div>`;
    setTimeout(()=>Charts.macros('cDietMacro',h.macros),50);
  }
};

/* ─────────────────────────────────────────────────────────────
   FITNESS
───────────────────────────────────────────────────────────── */
const Fitness = {
  PLANS:{
    lose:[{day:'Mon',type:'cardio',ex:['30 min brisk walk/jog','Jump rope 10 min','Bodyweight squats 3×15','Mountain climbers 3×20']},{day:'Tue',type:'strength',ex:['Push-ups 4×12','Dumbbell rows 3×12','Plank 3×45 sec','Tricep dips 3×15']},{day:'Wed',type:'cardio',ex:['45 min cycling or elliptical','High knees 3×30 sec','Burpees 3×10','Cool-down stretch 10 min']},{day:'Thu',type:'strength',ex:['Lunges 3×12 each side','Shoulder press 3×12','Lat pulldowns 3×12','Core circuit 15 min']},{day:'Fri',type:'hiit',ex:['HIIT 20 min (30s on / 10s off)','Sprint intervals 6×200 m','Box jumps 3×10','Battle ropes 3×30 sec']},{day:'Sat',type:'cardio',ex:['60 min outdoor hike or walk','Light yoga 20 min','Foam rolling 10 min']},{day:'Sun',type:'rest',ex:['Active recovery','Gentle stretching 20 min','Hydrate & meal prep']}],
    gain:[{day:'Mon',type:'strength',ex:['Bench press 4×8','Incline dumbbell press 3×10','Cable flyes 3×12','Tricep pushdowns 4×12']},{day:'Tue',type:'strength',ex:['Barbell squats 4×8','Romanian deadlifts 3×10','Leg press 3×12','Calf raises 4×15']},{day:'Wed',type:'cardio',ex:['20 min light cardio','Foam rolling','Mobility work']},{day:'Thu',type:'strength',ex:['Pull-ups 4×8','Barbell rows 4×8','Lat pulldowns 3×12','Face pulls 3×15']},{day:'Fri',type:'strength',ex:['Overhead press 4×8','Arnold press 3×10','Lateral raises 3×15','Bicep curls 4×12']},{day:'Sat',type:'strength',ex:['Deadlifts 4×6','Hip thrusts 3×12','Leg curls 3×12','Core 15 min']},{day:'Sun',type:'rest',ex:['Full rest','Meal prep','Sleep 8+ hours']}],
    maintain:[{day:'Mon',type:'strength',ex:['Full body circuit 3 rounds','Push-ups / rows / squats','Core 10 min','Stretch 10 min']},{day:'Tue',type:'cardio',ex:['30 min jog or bike','Jump rope 10 min','Agility drills']},{day:'Wed',type:'strength',ex:['Upper body 45 min','Compound lifts priority','Accessory work 15 min']},{day:'Thu',type:'cardio',ex:['35 min swim or row','LISS moderate pace','Yoga flow 15 min']},{day:'Fri',type:'hiit',ex:['HIIT circuit 25 min','Mixed weights + cardio','Finisher 5 min']},{day:'Sat',type:'cardio',ex:['Outdoor activity: hike, sport, cycle','Mobility 20 min']},{day:'Sun',type:'rest',ex:['Complete rest','Light stretching','Plan next week']}]
  },
  BC:{cardio:'badge-cardio',strength:'badge-strength',rest:'badge-rest',hiit:'badge-hiit'},
  init() {
    const user=DB.session(); if(!user) return;
    const health=DB.getHealth(user.email);
    this._render(health);
    const dist=health?.goal==='lose'?[4,2,1]:health?.goal==='gain'?[2,4,1]:[3,3,1];
    setTimeout(()=>Charts.workoutDist('cWorkout',dist[0],dist[1],dist[2]),50);
  },
  _render(h) {
    const el=document.getElementById('fitnessWrap'); if(!el) return;
    if(!h){ el.innerHTML=`<div class="card"><div class="empty-state"><div class="empty-icon">💪</div><p>Complete your <a href="#" onclick="Router.go('bmi')">BMI profile</a> first.</p></div></div>`; return; }
    const plan=this.PLANS[h.goal]||this.PLANS.maintain;
    const actLevels={sedentary:1,lightly:2,moderately:3,active:4,very_active:5};
    const intLevel=actLevels[h.activity]||3;
    const intLabels=['Beginner','Light','Moderate','Active','Elite'];
    const intColors=['#3b82f6','#22c55e','#f59e0b','#f97316','#ef4444'];
    const barH=[20,35,50,65,80];
    el.innerHTML=`
      <div class="g3 mb-20 stagger">
        <div class="stat-card"><div class="accent-bar" style="background:var(--primary)"></div><div class="stat-label">Training Style</div><div class="stat-value" style="font-size:1.2rem;color:var(--primary)">${h.goal==='lose'?'Fat Burn':h.goal==='gain'?'Hypertrophy':'Maintenance'}</div><div class="stat-meta">${h.goal==='lose'?'Cardio-dominant':h.goal==='gain'?'Strength-dominant':'Balanced split'}</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:#3b82f6"></div><div class="stat-label">Active Days/Week</div><div class="stat-value" style="color:#3b82f6">${plan.filter(d=>d.type!=='rest').length}</div><div class="stat-meta">sessions planned</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:#94a3b8"></div><div class="stat-label">Rest Days</div><div class="stat-value" style="color:#64748b">${plan.filter(d=>d.type==='rest').length}</div><div class="stat-meta">recovery days</div></div>
      </div>
      <div class="g32">
        <div class="card"><div class="card-title mb-16">📅 Weekly Schedule</div>${plan.map(d=>`<div class="workout-day"><div class="workout-day-head"><span class="workout-day-name">${d.day}</span><span class="workout-badge ${this.BC[d.type]}">${d.type.toUpperCase()}</span></div><div class="workout-exercises">${d.ex.map(e=>`<div class="ex-item">${e}</div>`).join('')}</div></div>`).join('')}</div>
        <div>
          <div class="card mb-20"><div class="card-title mb-16">⚡ Intensity Level</div>
            <div style="display:flex;gap:4px;align-items:flex-end;height:50px">${Array.from({length:5},(_,i)=>`<div style="flex:1;height:${barH[i]}%;background:${i<intLevel?intColors[i]:'#f1f5f9'};border-radius:3px;transition:height 0.4s"></div>`).join('')}</div>
            <div style="text-align:center;font-size:0.75rem;color:var(--text-muted);margin-top:8px;font-weight:600">${intLabels[intLevel-1]}</div>
          </div>
          <div class="card"><div class="card-title mb-16">🥧 Split Distribution</div><div class="chart-wrap h220"><canvas id="cWorkout"></canvas></div></div>
        </div>
      </div>`;
    setTimeout(()=>Charts.workoutDist('cWorkout',dist?.[0]||3,dist?.[1]||3,1),50);
    const dist=h.goal==='lose'?[4,2,1]:h.goal==='gain'?[2,4,1]:[3,3,1];
    setTimeout(()=>Charts.workoutDist('cWorkout',dist[0],dist[1],dist[2]),80);
  }
};

/* ─────────────────────────────────────────────────────────────
   GOALS
───────────────────────────────────────────────────────────── */
const Goals = {
  init() {
    const user=DB.session(); if(!user) return;
    this._render(DB.getHealth(user.email),user.email);
  },
  _targetBMI(goal){ return goal==='lose'?22:goal==='gain'?23:22; },
  _progress(current,initial,target){
    if(!current||initial===target) return 0;
    const correctDir=(target>initial&&current>initial)||(target<initial&&current<initial);
    if(!correctDir) return 0;
    return Math.min(100,Math.max(0,Math.round(((current-initial)/(target-initial))*100)));
  },
  _status(pct){
    if(pct<10) return {msg:'Getting Started 🚀',color:'#94a3b8'};
    if(pct<40) return {msg:'Making Progress 📈',color:'#3b82f6'};
    if(pct<80) return {msg:'Almost There! 🔥',color:'#f59e0b'};
    return {msg:'Goal Achieved! 🎉',color:'#22c55e'};
  },
  _render(h,email){
    const el=document.getElementById('goalsWrap'); if(!el) return;
    if(!h){ el.innerHTML=`<div class="card"><div class="empty-state"><div class="empty-icon">🎯</div><p>Complete your <a href="#" onclick="Router.go('bmi')">BMI profile</a> to track goals.</p></div></div>`; return; }
    const target=this._targetBMI(h.goal);
    const initial=h.initialBMI||h.bmi;
    if(!h.initialBMI) DB.saveHealth(email,{initialBMI:h.bmi});
    const pct=this._progress(h.bmi,initial,target);
    const status=this._status(pct);
    if(pct>=100) DB.unlockAchievement(email,'goal_achieved');
    const milestones=[
      {label:'Journey Started',sub:`Initial BMI: ${initial}`,done:true},
      {label:'25% Progress',sub:`BMI: ${(initial+(target-initial)*0.25).toFixed(1)}`,done:pct>=25},
      {label:'50% Progress',sub:`BMI: ${((initial+target)/2).toFixed(1)}`,done:pct>=50},
      {label:'75% Progress',sub:`BMI: ${(initial+(target-initial)*0.75).toFixed(1)}`,done:pct>=75},
      {label:'🏆 Goal Reached',sub:`Target BMI: ${target}`,done:pct>=100},
    ];
    el.innerHTML=`
      <div class="g3 mb-20 stagger">
        <div class="stat-card"><div class="accent-bar" style="background:#3b82f6"></div><div class="stat-label">Initial BMI</div><div class="stat-value" style="color:#3b82f6">${initial}</div><div class="stat-meta">starting point</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:var(--primary)"></div><div class="stat-label">Current BMI</div><div class="stat-value" style="color:var(--primary)">${h.bmi}</div><div class="stat-meta">${BMICalc.category(h.bmi).label}</div></div>
        <div class="stat-card"><div class="accent-bar" style="background:#f59e0b"></div><div class="stat-label">Target BMI</div><div class="stat-value" style="color:#f59e0b">${target}</div><div class="stat-meta">${h.goal==='lose'?'Weight Loss':h.goal==='gain'?'Muscle Gain':'Maintain'}</div></div>
      </div>
      <div class="g2">
        <div class="card"><div class="card-title mb-16">🎯 Goal Progress</div>
          <div style="text-align:center;padding:16px 0"><div style="font-size:3rem;font-weight:800;color:${status.color}">${pct}%</div><div style="font-size:0.9rem;font-weight:600;color:${status.color};margin-top:4px">${status.msg}</div></div>
          <div class="prog-bar lg mb-16"><div class="prog-fill green" style="width:${pct}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted)"><span>BMI ${initial}</span><span>Target BMI ${target}</span></div>
          ${pct>=100?'':pct===0?`<div style="margin-top:16px" class="health-alert warn"><span class="ha-icon">⚠️</span><div class="ha-text"><strong>Off Track</strong>Your BMI is moving away from your target. <a href="#" onclick="Router.go('bmi')">Update your BMI</a>.</div></div>`:`<div style="margin-top:16px" class="health-alert info"><span class="ha-icon">📅</span><div class="ha-text"><strong>Projection</strong>At current pace, ~${Math.ceil(Math.abs(h.bmi-target)/0.2)} weeks to reach target BMI ${target}.</div></div>`}
        </div>
        <div class="card"><div class="card-title mb-16">🗺️ Milestones</div>${milestones.map(m=>`<div class="milestone-row"><div class="ms-dot${m.done?' done':''}"></div><div class="ms-info"><div class="ms-label">${m.label}</div><div class="ms-sub">${m.sub}</div></div><span>${m.done?'✅':'○'}</span></div>`).join('')}</div>
      </div>`;
  }
};

/* ─────────────────────────────────────────────────────────────
   TRACKER
───────────────────────────────────────────────────────────── */
const Tracker = {
  ITEMS:[{key:'water',emoji:'💧',label:'Water Intake',unit:'glasses',max:10,goal:8,step:1,color:'blue'},{key:'exercise',emoji:'🏃',label:'Exercise',unit:'min',max:180,goal:60,step:1,color:'green'},{key:'steps',emoji:'👟',label:'Steps Walked',unit:'steps',max:20000,goal:10000,step:500,color:'orange'},{key:'sleep',emoji:'😴',label:'Sleep Hours',unit:'hrs',max:12,goal:8,step:0.5,color:'purple'}],
  user:null, data:{},
  init(){
    this.user=DB.session(); if(!this.user) return;
    this.data={...DB.getTracker(this.user.email).today};
    this._render();
    setTimeout(()=>Charts.weeklyActivity('cTrackerWeekly',this.user.email),50);
  },
  _render(){
    const el=document.getElementById('trackerItems'); if(!el) return;
    const total=this.ITEMS.reduce((sum,it)=>sum+Math.min(100,Math.round(((this.data[it.key]||0)/it.goal)*100)),0);
    const avg=Math.round(total/this.ITEMS.length);
    const scoreEl=document.getElementById('dailyScore'); if(scoreEl) scoreEl.textContent=avg+'%';
    const ring=document.getElementById('dailyRing');
    if(ring){ const c=2*Math.PI*45; setTimeout(()=>{ ring.style.strokeDasharray=c; ring.style.strokeDashoffset=c-(avg/100)*c; },80); }
    el.innerHTML=this.ITEMS.map(it=>{ const v=this.data[it.key]||0; const pct=Math.min(100,Math.round((v/it.goal)*100));
      return `<div class="tracker-item"><span class="tracker-emoji">${it.emoji}</span><div class="tracker-info"><div class="tracker-name">${it.label}</div><div class="prog-header" style="margin-bottom:5px"><span style="font-size:0.78rem;color:var(--text-muted)">${v} / ${it.goal} ${it.unit}</span><span style="font-size:0.78rem;font-weight:700">${pct}%</span></div><div class="prog-bar"><div class="prog-fill ${it.color}" style="width:${pct}%"></div></div></div><div class="tracker-ctrls"><button class="ctrl-btn" onclick="Tracker._adj('${it.key}',-${it.step})">−</button><span class="ctrl-count">${v}</span><button class="ctrl-btn" onclick="Tracker._adj('${it.key}',${it.step})">+</button></div></div>`; }).join('');
  },
  _adj(key,delta){
    const it=this.ITEMS.find(i=>i.key===key); if(!it) return;
    this.data[key]=Math.max(0,Math.min(it.max,(this.data[key]||0)+delta));
    DB.saveTrackerToday(this.user.email,this.data);
    this._render();
    if(this.data[key]>=it.goal) App.toast(`${it.emoji} ${it.label} goal hit!`,'success');
  }
};

/* ─────────────────────────────────────────────────────────────
   REMINDERS
───────────────────────────────────────────────────────────── */
const Reminders = {
  TYPES:[{v:'water',label:'💧 Drink Water',icon:'💧'},{v:'exercise',label:'🏃 Exercise Time',icon:'🏃'},{v:'walk',label:'🚶 Take a Walk',icon:'🚶'},{v:'sleep',label:'😴 Sleep Reminder',icon:'😴'},{v:'meal',label:'🍽️ Meal Time',icon:'🍽️'}],
  user:null,
  init(){ this.user=DB.session(); if(!this.user) return; this._render(); },
  _add(){
    const type=document.getElementById('remType').value;
    const time=document.getElementById('remTime').value;
    const label=document.getElementById('remLabel').value||this.TYPES.find(t=>t.v===type)?.label||'Reminder';
    if(!type||!time){ App.toast('Fill in all fields.','error'); return; }
    DB.addReminder(this.user.email,{type,time,label});
    this._render();
    document.getElementById('remTime').value='';
    document.getElementById('remLabel').value='';
    App.toast('Reminder saved! ⏰','success');
  },
  _render(){
    const el=document.getElementById('remList'); if(!el) return;
    const arr=DB.getReminders(this.user.email).sort((a,b)=>a.time.localeCompare(b.time));
    if(!arr.length){ el.innerHTML='<div class="empty-state"><div class="empty-icon">⏰</div><p>No reminders yet. Add one above!</p></div>'; return; }
    el.innerHTML=arr.map(r=>{ const t=this.TYPES.find(x=>x.v===r.type)||{icon:'🔔'};
      return `<div class="reminder-row"><span style="font-size:1.3rem">${t.icon}</span><div class="reminder-info"><div class="reminder-title">${r.label}</div><div class="reminder-type">${r.type} · ${r.on?'Active':'Off'}</div></div><span class="reminder-time">${r.time}</span><label class="toggle"><input type="checkbox" ${r.on?'checked':''} onchange="Reminders._toggle(${r.id})"><span class="toggle-slider"></span></label><button class="btn btn-sm btn-danger" onclick="Reminders._del(${r.id})">×</button></div>`; }).join('');
  },
  _del(id){ DB.deleteReminder(this.user.email,id); this._render(); App.toast('Reminder deleted.','info'); },
  _toggle(id){ DB.toggleReminder(this.user.email,id); this._render(); }
};

/* ─────────────────────────────────────────────────────────────
   ACHIEVEMENTS
───────────────────────────────────────────────────────────── */
const Achievements = {
  init(){
    const user=DB.session(); if(!user) return;
    DB.checkTrackerAchievements(user.email,DB.getTracker(user.email).all);
    this._render(user.email);
  },
  _render(email){
    const arr=DB.getAchievements(email);
    const earned=arr.filter(a=>a.earned).length;
    const el=document.getElementById('achGrid'); if(!el) return;
    const count=document.getElementById('achCount'); if(count) count.textContent=`${earned} / ${arr.length}`;
    const prog=document.getElementById('achProg'); if(prog) prog.style.width=Math.round((earned/arr.length)*100)+'%';
    el.innerHTML=arr.map(a=>`<div class="badge-card${a.earned?' earned':' locked'}"><div class="badge-icon">${a.icon}</div><div class="badge-name">${a.name}</div><div class="badge-desc">${a.desc}</div><span class="earned-chip ${a.earned?'yes':'no'}">${a.earned?'Earned':'Locked'}</span>${a.earnedAt?`<div style="font-size:0.6rem;color:var(--text-muted);margin-top:4px">${DB.fmtDate(new Date(a.earnedAt).toISOString().split('T')[0])}</div>`:''}</div>`).join('');
  }
};

/* ─────────────────────────────────────────────────────────────
   PROFILE
───────────────────────────────────────────────────────────── */
const Profile = {
  user:null, health:null,
  init(){
    this.user=DB.session(); if(!this.user) return;
    this.health=DB.getHealth(this.user.email);
    this._render();
    const em=document.getElementById('profAccountEmail'); if(em) em.textContent=this.user.email;
  },
  _render(){
    const u=this.user,h=this.health;
    const initials=u.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
    const hero=document.getElementById('profHero');
    if(hero){ const earned=DB.getAchievements(u.email).filter(a=>a.earned).length;
      hero.innerHTML=`<div class="profile-ava-lg">${initials}</div><div><div class="profile-name">${u.name}</div><div class="profile-email">${u.email}</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${h?`<span class="chip chip-green">${BMICalc.category(h.bmi).label}</span><span class="chip chip-${h.goal==='lose'?'blue':h.goal==='gain'?'green':'orange'}">${h.goal==='lose'?'🔥 Weight Loss':h.goal==='gain'?'💪 Muscle Gain':'⚖️ Maintenance'}</span>`:''}<span class="chip chip-gray">🏆 ${earned} Badges</span></div></div>`; }
    const fields={profName:u.name};
    if(h) Object.assign(fields,{profHeight:h.height,profWeight:h.weight,profAge:h.age,profGender:h.gender,profActivity:h.activity,profGoal:h.goal});
    Object.entries(fields).forEach(([id,v])=>{ const el=document.getElementById(id); if(el&&v!=null) el.value=v; });
  },
  _save(){
    const name=document.getElementById('profName').value.trim();
    const weight=+document.getElementById('profWeight').value;
    const height=+document.getElementById('profHeight').value;
    const age=+document.getElementById('profAge').value;
    const gender=document.getElementById('profGender').value;
    const activity=document.getElementById('profActivity').value;
    const goal=document.getElementById('profGoal').value;
    DB.updateUser(this.user.email,{name});
    if(weight&&height&&age){
      const bmi=BMICalc.calc(weight,height);
      const bmrVal=BMICalc.bmr(weight,height,age,gender);
      const tdeeVal=BMICalc.tdee(bmrVal,activity);
      const calories=BMICalc.goalCalories(tdeeVal,goal);
      const macros=BMICalc.macros(calories,goal);
      const score=BMICalc.healthScore(bmi,this.health?.mood||'neutral',activity);
      DB.saveHealth(this.user.email,{weight,height,age,gender,activity,goal,bmi,bmrVal,tdeeVal,calories,macros,score});
    }
    DB.unlockAchievement(this.user.email,'profile_done');
    this.user=DB.session(); this.health=DB.getHealth(this.user.email);
    this._render();
    App.toast('Profile updated! 👤','success');
  },
  _export(){
    const data=DB.export(this.user.email);
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`wellnesstrack-${this.user.name.replace(/\s+/g,'-')}-${new Date().toISOString().split('T')[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
    App.toast('Data exported! 📦','success');
  }
};
