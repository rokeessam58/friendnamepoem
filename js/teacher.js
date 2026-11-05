(function () {
  var $ = function (id) { return document.getElementById(id); };
  var pw = '';
  var rows = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function msg(el, text, ok) { el.textContent = text || ''; el.classList.toggle('hidden', !text); el.classList.toggle('ok', !!ok); }
  function t(action, data) { return Api.call(action, Object.assign({ password: pw }, data || {})); }

  // 브라우저 기본 confirm 대신 페이지 안 모달 (Promise<boolean>)
  function confirmModal(text, title, okLabel) {
    return new Promise(function (resolve) {
      var modal = $('confirm-modal');
      $('confirm-title').textContent = title || '확인해 주세요';
      $('confirm-text').textContent = text;
      $('confirm-ok').textContent = okLabel || '확인';
      modal.classList.remove('hidden');
      $('confirm-ok').focus();
      function done(v) {
        modal.classList.add('hidden');
        $('confirm-ok').removeEventListener('click', onOk);
        $('confirm-cancel').removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(v);
      }
      function onOk() { done(true); }
      function onCancel() { done(false); }
      function onBackdrop(e) { if (e.target === modal) done(false); }
      function onKey(e) { if (e.key === 'Escape') done(false); }
      $('confirm-ok').addEventListener('click', onOk);
      $('confirm-cancel').addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
    });
  }

  if (Api.isDemo) $('t-demo').classList.remove('hidden');

  /* ----- 로그인 ----- */
  async function enter(password) {
    pw = password;
    await t('tCheck');
    try { sessionStorage.setItem('manito_t_pw', pw); } catch (e) {}
    $('t-login').classList.add('hidden');
    $('t-main').classList.remove('hidden');
    loadRoster();
    loadResults();
  }
  $('t-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    msg($('t-login-msg'), '');
    try {
      await Api.run(e.target.querySelector('button'), function () { return enter($('t-pw').value); });
    } catch (err) { msg($('t-login-msg'), '😢 ' + err.message); }
  });
  $('t-logout').addEventListener('click', function () {
    try { sessionStorage.removeItem('manito_t_pw'); } catch (e) {}
    location.reload();
  });
  (function restore() {
    var saved; try { saved = sessionStorage.getItem('manito_t_pw'); } catch (e) {}
    if (!saved) return;
    $('t-login').classList.add('hidden');
    $('t-boot').classList.remove('hidden'); // 확인하는 동안 로딩 화면
    enter(saved).catch(function () {
      try { sessionStorage.removeItem('manito_t_pw'); } catch (e) {}
      $('t-login').classList.remove('hidden');
    }).then(function () { $('t-boot').classList.add('hidden'); });
  })();

  /* ----- 탭 ----- */
  document.querySelectorAll('.tab[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tab[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
      ['roster', 'shuffle', 'results'].forEach(function (n) { $('tab-' + n).classList.toggle('hidden', n !== b.dataset.tab); });
      if (b.dataset.tab !== 'roster') loadResults();
    });
  });

  /* ----- 명단 ----- */
  async function loadRoster() {
    var ta = $('roster-text'), ph = ta.placeholder;
    ta.disabled = true; ta.placeholder = '불러오는 중…';
    try {
      var list = await t('tGetStudents');
      $('roster-text').value = list.map(function (r) { return r[0] + ' ' + r[1]; }).join('\n');
    } catch (err) { msg($('roster-msg'), '😢 ' + err.message); }
    ta.disabled = false; ta.placeholder = ph;
  }
  $('btn-sample').addEventListener('click', function () {
    var names = ['김민준', '이서연', '박지호', '최수아', '정하준', '강지우', '조예준', '윤서윤', '장도윤', '임하은'];
    $('roster-text').value = names.map(function (n, i) { return (10101 + i) + ' ' + n; }).join('\n');
  });
  $('btn-roster-save').addEventListener('click', async function () {
    var btn = this;
    if (btn.classList.contains('loading')) return;
    var lines = $('roster-text').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var students = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(/[\s,]+/).filter(Boolean);
      if (parts.length < 2) { msg($('roster-msg'), '😢 ' + (i + 1) + '번째 줄을 확인해 주세요: "' + lines[i] + '" (학번과 이름이 필요해요)'); return; }
      students.push([parts[0], parts.slice(1).join('')]);
    }
    if (!students.length) { msg($('roster-msg'), '😢 명단이 비어 있어요.'); return; }
    if (!await confirmModal('명단 ' + students.length + '명을 저장할까요?\n기존 명단·마니또 배정·뽑기 기록은 초기화돼요.', '명단 저장', '저장')) return;
    try {
      await Api.run(btn, async function () {
        var n = await t('tSetStudents', { students: students });
        msg($('roster-msg'), '✅ ' + n + '명 저장했어요. 이제 [② 마니또 셔플]을 해 주세요.', true);
        await loadResults();
      });
    } catch (err) { msg($('roster-msg'), '😢 ' + err.message); }
  });

  /* ----- 셔플 ----- */
  $('btn-shuffle').addEventListener('click', async function () {
    var btn = this;
    if (btn.classList.contains('loading')) return;
    var assigned = rows.some(function (r) { return r.manitoName; });
    if (assigned && !await confirmModal('이미 마니또가 정해져 있어요.\n다시 셔플하면 배정이 바뀌고 학생들의 뽑기 상태도 초기화돼요. 계속할까요?', '다시 셔플할까요?', '다시 셔플')) return;
    try {
      await Api.run(btn, async function () {
        var n = await t('tShuffle');
        msg($('shuffle-msg'), '✅ ' + n + '명의 마니또를 섞어서 저장했어요! 결과 조회에서 확인할 수 있어요.', true);
        await loadResults();
      });
    } catch (err) { msg($('shuffle-msg'), '😢 ' + err.message); }
  });
  $('btn-reset-draw').addEventListener('click', async function () {
    var btn = this;
    if (btn.classList.contains('loading')) return;
    if (!await confirmModal('학생들의 "뽑기" 상태만 처음으로 돌릴까요?\n(마니또 배정은 그대로예요)', '뽑기 상태 초기화', '초기화')) return;
    try {
      await Api.run(btn, async function () {
        await t('tResetDraw');
        msg($('shuffle-msg'), '✅ 뽑기 상태를 초기화했어요.', true);
        await loadResults();
      });
    } catch (err) { msg($('shuffle-msg'), '😢 ' + err.message); }
  });

  /* ----- 결과 ----- */
  async function loadResults() {
    if (!rows.length) { // 처음 불러올 때만 표 자리에 로딩 표시
      $('shuffle-body').innerHTML = '<tr><td colspan="4">불러오는 중…</td></tr>';
      $('result-body').innerHTML = '<tr><td colspan="7">불러오는 중…</td></tr>';
    }
    try {
      rows = await t('tResults');
      renderResults();
    } catch (err) { msg($('result-msg'), '😢 ' + err.message); }
  }
  function renderResults() {
    msg($('result-msg'), '');
    var assigned = rows.filter(function (r) { return r.manitoName; }).length;
    var drawn = rows.filter(function (r) { return r.drawnAt; }).length;
    var poems = rows.filter(function (r) { return r.lines; }).length;
    var stat = '<span>👥 등록 ' + rows.length + '명</span><span>🎲 배정 ' + assigned + '명</span><span>💌 뽑기 완료 ' + drawn + '명</span><span>✏️ 삼행시 ' + poems + '명</span>';
    $('result-stat').innerHTML = stat;
    $('shuffle-stat').innerHTML = stat;
    $('shuffle-body').innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>🎁</td><td><b>' + esc(r.manitoName || '아직 셔플 전') + '</b></td></tr>';
    }).join('') || '<tr><td colspan="4">등록된 학생이 없어요.</td></tr>';
    $('result-body').innerHTML = rows.map(function (r, i) {
      var poem = r.lines ? r.lines.map(function (l) { return esc(l); }).join('<br>') : '<span class="tag n">아직 없음</span>';
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>' + (r.manitoName ? esc(r.manitoName) : '-') + '</td>' +
        '<td>' + (r.drawnAt ? '<span class="tag y">완료</span>' : '<span class="tag n">대기</span>') + '</td>' +
        '<td class="poem">' + poem + '</td><td>' + esc(Api.fmt(r.savedAt) || '-') + (r.count > 1 ? ' <small>(' + r.count + '회)</small>' : '') + '</td>' +
        '<td>' + (r.count ? '<button class="btn small ghost" data-hist="' + i + '">기록</button>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="7">등록된 학생이 없어요.</td></tr>';
  }
  $('btn-reload').addEventListener('click', function () { Api.run(this, loadResults); });
  $('result-body').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-hist]');
    if (!b) return;
    var r = rows[+b.dataset.hist];
    try {
      var list = await Api.run(b, function () { return t('tHistory', { id: r.id }); });
      if (!list) return;
      $('modal-title').textContent = r.name + ' → ' + r.manitoName + ' 저장 기록';
      $('modal-body').innerHTML = list.map(function (h, i) {
        return '<div class="hist"><small>' + esc(Api.fmt(h.at)) + (i === 0 ? ' · 최신' : '') + '</small>' + h.lines.map(esc).join('<br>') + '</div>';
      }).join('');
      $('modal').classList.remove('hidden');
    } catch (err) { msg($('result-msg'), '😢 ' + err.message); }
  });
  $('modal-close').addEventListener('click', function () { $('modal').classList.add('hidden'); });
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

  $('btn-csv').addEventListener('click', function () {
    var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
    var csv = ['학번,이름,마니또학번,마니또이름,뽑기,삼행시,저장시각'].concat(rows.map(function (r) {
      return [r.id, r.name, r.manitoId, r.manitoName, r.drawnAt ? '완료' : '대기', r.lines ? r.lines.join(' / ') : '', Api.fmt(r.savedAt)].map(q).join(',');
    })).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = '마니또_삼행시_결과.csv';
    a.click();
  });
})();
