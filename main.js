/* PIVOT · main.js — orchestration only (router, state, wiring). */
(function () {
  'use strict';

  const STORAGE_KEY = 'pivot.state.v1';
  const SCREENS = ['landing', 'onboarding', 'quiz', 'analyzing', 'results', 'detail', 'roadmap'];

  const defaultState = () => ({
    profile: null,            // { name, age, budget, ...quizAnswers }
    answers: {},              // raw quiz answers by id
    quizPath: [],             // ordered question ids actually shown
    results: null,            // [ {id, score, why}, ... ]
    selectedDetail: null,     // business id
    roadmap: null,            // { businessId, weeks: [{id,title,actions,budget,done}, ...] }
    streakDays: 0,
    lastVisit: null,
    apiKey: '',
    settings: { bigText: false, reduceMotion: false }
  });

  const PIVOT = (window.PIVOT = window.PIVOT || {});
  PIVOT.state = defaultState();

  PIVOT.storage = {
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (_) { return null; }
    },
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(PIVOT.state)); }
      catch (_) {}
    },
    reset() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      PIVOT.state = defaultState();
    }
  };

  // ---- Router ----
  PIVOT.router = {
    current: 'landing',
    go(name) {
      if (!SCREENS.includes(name)) return;
      this.current = name;
      document.body.dataset.screen = name;
      document.querySelectorAll('.screen').forEach(el => {
        const match = el.dataset.screen === name;
        el.hidden = !match;
      });
      // bottom nav active state
      document.querySelectorAll('.bn-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.key === name);
      });
      // show bottom nav once user has results
      document.body.classList.toggle('show-nav', !!PIVOT.state.results);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // hooks
      if (name === 'results' && PIVOT.ui?.renderResults) PIVOT.ui.renderResults();
      if (name === 'roadmap' && PIVOT.ui?.renderRoadmap) PIVOT.ui.renderRoadmap();
      if (name === 'detail' && PIVOT.ui?.renderDetail) PIVOT.ui.renderDetail();
    }
  };

  // ---- Toast ----
  PIVOT.toast = function (msg, ms = 2400) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(PIVOT._toastT);
    PIVOT._toastT = setTimeout(() => { el.hidden = true; }, ms);
  };

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    const saved = PIVOT.storage.load();
    if (saved) Object.assign(PIVOT.state, saved);

    // streak update (one tick per local day)
    const today = new Date().toISOString().slice(0, 10);
    if (PIVOT.state.lastVisit !== today) {
      const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      PIVOT.state.streakDays = (PIVOT.state.lastVisit === yest)
        ? (PIVOT.state.streakDays || 0) + 1 : 1;
      PIVOT.state.lastVisit = today;
      PIVOT.storage.save();
    }

    applySettings();
    wireGlobal();
    wireOnboarding();

    // Resume CTA
    const resume = document.getElementById('btn-resume');
    if (PIVOT.state.results) resume.hidden = false;
    resume.addEventListener('click', () => {
      PIVOT.router.go(PIVOT.state.roadmap ? 'roadmap' : 'results');
    });

    document.getElementById('btn-start').addEventListener('click', () => {
      PIVOT.router.go('onboarding');
    });
    document.getElementById('btn-roadmap').addEventListener('click', () => {
      if (PIVOT.ui?.buildRoadmap) PIVOT.ui.buildRoadmap();
      PIVOT.router.go('roadmap');
    });

    PIVOT.router.go('landing');
  });

  function wireGlobal() {
    document.querySelectorAll('[data-go]').forEach(el => {
      el.addEventListener('click', () => PIVOT.router.go(el.dataset.go));
    });
    // Settings drawer
    const drawer = document.getElementById('settings-drawer');
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('api-key-input').value = PIVOT.state.apiKey || '';
      document.getElementById('big-text').checked = !!PIVOT.state.settings.bigText;
      document.getElementById('reduce-motion').checked = !!PIVOT.state.settings.reduceMotion;
      drawer.hidden = false;
    });
    document.getElementById('settings-close').addEventListener('click', () => drawer.hidden = true);
    drawer.addEventListener('click', e => { if (e.target === drawer) drawer.hidden = true; });
    document.getElementById('api-key-input').addEventListener('change', e => {
      PIVOT.state.apiKey = e.target.value.trim();
      PIVOT.storage.save();
      PIVOT.toast(PIVOT.state.apiKey ? '✨ Claude IA activé' : 'Mode local activé');
    });
    document.getElementById('big-text').addEventListener('change', e => {
      PIVOT.state.settings.bigText = e.target.checked;
      PIVOT.storage.save(); applySettings();
    });
    document.getElementById('reduce-motion').addEventListener('change', e => {
      PIVOT.state.settings.reduceMotion = e.target.checked;
      PIVOT.storage.save(); applySettings();
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('Tout réinitialiser ?')) return;
      PIVOT.storage.reset();
      drawer.hidden = true;
      PIVOT.router.go('landing');
      document.getElementById('btn-resume').hidden = true;
      PIVOT.toast('Réinitialisé');
    });
    // Coach toggles
    const coach = document.getElementById('coach-panel');
    const openCoach = () => { coach.hidden = false; coach.classList.add('open'); PIVOT.ui?.openCoach?.(); };
    document.getElementById('btn-coach-top').addEventListener('click', openCoach);
    document.getElementById('btn-coach-bottom').addEventListener('click', openCoach);
    document.getElementById('coach-close').addEventListener('click', () => {
      coach.classList.remove('open'); setTimeout(() => coach.hidden = true, 280);
    });
  }

  function wireOnboarding() {
    const form = document.getElementById('onboard-form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      PIVOT.state.profile = { ...(PIVOT.state.profile || {}), ...data };
      PIVOT.storage.save();
      if (PIVOT.quiz?.start) PIVOT.quiz.start();
      else PIVOT.router.go('quiz');
    });
  }

  function applySettings() {
    document.body.classList.toggle('big-text', !!PIVOT.state.settings.bigText);
    document.body.classList.toggle('no-motion', !!PIVOT.state.settings.reduceMotion);
  }
})();
