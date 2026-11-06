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

  /* 투표 (GAS 로직과 동일) */
  function vcfg(db) { return db.vote || { open: false, picks: 3 }; }
  function ballot(db) {
    var l = latest(db), order = {}, out = [];
    db.students.forEach(function (s, i) { order[s.id] = i; });
    db.students.forEach(function (s) {
      var p = l[s.id];
      if (!p || !s.mId) return;
      out.push({ key: s.mId, authorId: s.id, authorName: s.name, manitoName: s.mName, lines: p.lines, order: order[s.mId] });
    });
    return out.sort(function (a, b) { return a.order - b.order; });
  }
  function lastVotes(db) { var m = {}; (db.votes || []).forEach(function (v) { m[v.id] = v.keys; }); return m; }

  var demo = {
    login: function (db, r) { var s = find(db, r); return { id: s.id, name: s.name, drawn: !!s.drawnAt, vote: vcfg(db) }; },
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
    tHistory: function (db, r) { auth(r); return db.poems.filter(function (p) { return p.id === String(r.id); }).reverse(); },

    voteStatus: function (db, r) { find(db, r); return vcfg(db); },
    getBallot: function (db, r) {
      var s = find(db, r), cfg = vcfg(db);
      if (!cfg.open) throw new Error('아직 투표가 시작되지 않았어요.');
      var items = ballot(db).filter(function (p) { return p.authorId !== s.id; }).map(function (p) { return { key: p.key, manitoName: p.manitoName, lines: p.lines }; });
      return { picks: cfg.picks, items: items, selected: lastVotes(db)[s.id] || [] };
    },
    submitVote: function (db, r) {
      var s = find(db, r), cfg = vcfg(db);
      if (!cfg.open) throw new Error('투표가 마감되었어요.');
      var keys = (r.keys || []).map(String);
      if (new Set(keys).size !== keys.length) throw new Error('같은 삼행시를 두 번 고를 수 없어요.');
      if (keys.length !== cfg.picks) throw new Error('삼행시를 정확히 ' + cfg.picks + '개 골라 주세요.');
      var ok = {}; ballot(db).forEach(function (p) { if (p.authorId !== s.id) ok[p.key] = 1; });
      keys.forEach(function (k) { if (!ok[k]) throw new Error('고를 수 없는 삼행시가 포함되어 있어요.'); });
      db.votes = (db.votes || []).concat([{ at: now(), id: s.id, keys: keys }]);
      save(db);
      return { picks: cfg.picks };
    },
    tVoteGet: function (db, r) {
      auth(r);
      var c = vcfg(db);
      return { open: c.open, picks: c.picks, voters: Object.keys(lastVotes(db)).length, students: db.students.length, poems: ballot(db).length };
    },
    tVoteSet: function (db, r) {
      auth(r);
      if (r.open) {
        var picks = parseInt(r.picks, 10), total = ballot(db).length;
        if (!picks || picks < 1) throw new Error('고를 개수는 1 이상이어야 해요.');
        if (total < 2) throw new Error('저장된 삼행시가 2개 이상 있어야 투표를 시작할 수 있어요.');
        if (picks > total - 1) throw new Error('고를 개수가 투표 대상(최대 ' + (total - 1) + '개)보다 많아요.');
        db.vote = { open: true, picks: picks };
      } else {
        db.vote = { open: false, picks: vcfg(db).picks };
      }
      save(db);
      return demo.tVoteGet(db, r);
    },
    tVoteResults: function (db, r) {
      auth(r);
      var counts = {}, votes = lastVotes(db);
      Object.keys(votes).forEach(function (id) { votes[id].forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
      var list = ballot(db).map(function (p) { return { manitoName: p.manitoName, authorName: p.authorName, lines: p.lines, votes: counts[p.key] || 0, order: p.order }; });
      list.sort(function (a, b) { return b.votes - a.votes || a.order - b.order; });
      var rank = 0, prev = null;
      list.forEach(function (x, i) { if (x.votes !== prev) { rank = i + 1; prev = x.votes; } x.rank = rank; });
      return { voters: Object.keys(votes).length, items: list };
    },
    tVoteReset: function (db, r) { auth(r); db.votes = []; save(db); return true; }
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
