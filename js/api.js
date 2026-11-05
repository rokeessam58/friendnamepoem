// API 호출 래퍼. CONFIG.API_URL 이 비어 있으면 localStorage 기반 데모 모드로 동작.
window.Api = (function () {
  var DEMO = !CONFIG.API_URL;

  async function remote(action, data) {
    var res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      // text/plain 으로 보내야 CORS preflight 없이 GAS가 받을 수 있음
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    });
    var json = await res.json();
    if (!json.ok) throw new Error(json.error || '오류가 발생했어요.');
    return json.data;
  }

  /* ---------- 데모 모드 (GAS 로직과 동일하게 동작) ---------- */
  var KEY = 'manito_demo_db';
  var DEMO_PW = '1234';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || { students: [], poems: [] }; } catch (e) { return { students: [], poems: [] }; } }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function now() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
  function clean(s) { return String(s || '').replace(/\s+/g, ''); }
  function find(db, req) {
    var s = db.students.find(function (x) { return x.id === String(req.id || '').trim() && clean(x.name) === clean(req.name); });
    if (!s) throw new Error('학번과 이름이 명단과 맞지 않아요. 다시 확인해 주세요.');
    return s;
  }
  function auth(req) { if (req.password !== DEMO_PW) throw new Error('비밀번호가 맞지 않아요. (데모 비밀번호: 1234)'); }
  function latest(db) { var m = {}; db.poems.forEach(function (p) { m[p.id] = p; }); return m; }

  var demo = {
    login: function (db, r) { var s = find(db, r); return { id: s.id, name: s.name, drawn: !!s.drawnAt }; },
    draw: function (db, r) {
      var s = find(db, r);
      if (!s.mName) throw new Error('아직 선생님이 마니또를 정하지 않았어요. 조금만 기다려 주세요!');
      if (!s.drawnAt) { s.drawnAt = now(); save(db); }
      return { manitoName: s.mName, names: db.students.map(function (x) { return x.name; }) };
    },
    getPoem: function (db, r) {
      var s = find(db, r);
      if (!s.drawnAt) throw new Error('먼저 마니또를 뽑아 주세요!');
      var p = latest(db)[s.id];
      return { manitoName: s.mName, lines: p ? p.lines : null, savedAt: p ? p.at : null };
    },
    savePoem: function (db, r) {
      var s = find(db, r);
      if (!s.drawnAt) throw new Error('먼저 마니또를 뽑아 주세요!');
      if (!Array.isArray(r.lines) || r.lines.length !== Array.from(s.mName).length) throw new Error('삼행시 줄 수가 맞지 않아요.');
      var at = now();
      db.poems.push({ at: at, id: s.id, name: s.name, manitoName: s.mName, lines: r.lines.map(function (x) { return String(x).slice(0, 200); }) });
      save(db);
      return { savedAt: at };
    },
    tCheck: function (db, r) { auth(r); return true; },
    tGetStudents: function (db, r) { auth(r); return db.students.map(function (s) { return [s.id, s.name]; }); },
    tSetStudents: function (db, r) {
      auth(r);
      var seen = {};
      db.students = r.students.map(function (x) {
        var id = String(x[0]).trim(), name = clean(x[1]);
        if (!id || !name) throw new Error('학번/이름이 비어 있는 줄이 있어요.');
        if (seen[id]) throw new Error('학번이 중복되었어요: ' + id);
        seen[id] = true;
        return { id: id, name: name, mId: '', mName: '', drawnAt: '' };
      });
      save(db);
      return db.students.length;
    },
    tShuffle: function (db, r) {
      auth(r);
      var n = db.students.length;
      if (n < 2) throw new Error('학생이 2명 이상 등록되어야 해요.');
      var perm;
      do {
        perm = Array.from({ length: n }, function (_, i) { return i; });
        for (var i = n - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      } while (perm.some(function (v, i) { return v === i; }));
      db.students.forEach(function (s, i) { s.mId = db.students[perm[i]].id; s.mName = db.students[perm[i]].name; s.drawnAt = ''; });
      save(db);
      return n;
    },
    tResetDraw: function (db, r) { auth(r); db.students.forEach(function (s) { s.drawnAt = ''; }); save(db); return true; },
    tResults: function (db, r) {
      auth(r);
      var l = latest(db);
      return db.students.map(function (s) {
        var p = l[s.id];
        return { id: s.id, name: s.name, manitoId: s.mId, manitoName: s.mName, drawnAt: s.drawnAt, lines: p ? p.lines : null, savedAt: p ? p.at : null, count: db.poems.filter(function (x) { return x.id === s.id; }).length };
      });
    },
    tHistory: function (db, r) { auth(r); return db.poems.filter(function (p) { return p.id === String(r.id); }).reverse(); }
  };

  async function call(action, data) {
    if (!DEMO) return remote(action, data);
    await new Promise(function (r) { setTimeout(r, 250); }); // 로딩 느낌
    return demo[action](load(), data || {});
  }

  // 버튼 로딩 표시: 실행하는 동안 버튼에 스피너를 띄우고 중복 클릭을 막음.
  // 이미 실행 중이면 undefined 를 돌려줌 (호출한 쪽은 결과가 없으면 그냥 return)
  async function run(btn, fn) {
    if (btn.classList.contains('loading')) return undefined;
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
    try {
      return await fn();
    } finally {
      btn.classList.remove('loading');
      btn.removeAttribute('aria-busy');
    }
  }

  // 시각 표시용: yyyy. MM. dd. HH:mm:ss (GMT 등 불필요한 부분 제거)
  function fmt(v) {
    if (!v) return '';
    var p2 = function (n) { return String(n).padStart(2, '0'); };
    var m = String(v).match(/^(\d{4})[-.\s]+(\d{1,2})[-.\s]+(\d{1,2})\.?\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) return m[1] + '. ' + p2(m[2]) + '. ' + p2(m[3]) + '. ' + p2(m[4]) + ':' + m[5] + ':' + m[6];
    var d = new Date(v);
    if (isNaN(d)) return String(v);
    return d.getFullYear() + '. ' + p2(d.getMonth() + 1) + '. ' + p2(d.getDate()) + '. ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }

  return { call: call, run: run, fmt: fmt, isDemo: DEMO };
})();
