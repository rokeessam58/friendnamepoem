(function () {
  var $ = function (id) { return document.getElementById(id); };
  var pw = '';
  var rows = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 삼행시 표시: 줄마다 "홍: 내용". 줄이 길어 넘어가면 둘째 줄부터도 내용 첫 글자에 맞춰 정렬
  function poemHtml(manito, lines) {
    var chars = Array.from(manito || '');
    return lines.map(function (l, i) {
      return '<div class="pl"><span class="pl-c">' + esc(chars[i] || Array.from(String(l))[0] || '') + ':</span><span class="pl-t">' + esc(l) + '</span></div>';
    }).join('');
  }
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
    loadCodes();
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
      ['roster', 'shuffle', 'results', 'vote'].forEach(function (n) { $('tab-' + n).classList.toggle('hidden', n !== b.dataset.tab); });
      if (b.dataset.tab === 'vote') loadVote();
      else if (b.dataset.tab !== 'roster') loadResults();
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
  /* ----- 인증코드 ----- */
  var codes = [];
  async function loadCodes() {
    $('codes-body').innerHTML = '<tr><td colspan="3">불러오는 중…</td></tr>';
    try { codes = await t('tCodes'); renderCodes(); }
    catch (err) { $('codes-body').innerHTML = ''; msg($('codes-msg'), '😢 ' + err.message); }
  }
  function renderCodes() {
    msg($('codes-msg'), '');
    $('codes-body').innerHTML = codes.map(function (c) {
      return '<tr><td>' + esc(c[0]) + '</td><td>' + esc(c[1]) + '</td><td><span class="code-chip">' + esc(c[2]) + '</span></td></tr>';
    }).join('') || '<tr><td colspan="3">등록된 학생이 없어요.</td></tr>';
  }
  $('btn-codes-copy').addEventListener('click', async function () {
    var text = codes.map(function (c) { return c.join('\t'); }).join('\n');
    try { await navigator.clipboard.writeText(text); msg($('codes-msg'), '✅ 복사했어요. 엑셀/시트에 붙여넣을 수 있어요.', true); }
    catch (e) { msg($('codes-msg'), '😢 복사하지 못했어요. 표를 직접 드래그해서 복사해 주세요.'); }
  });
  $('btn-codes-regen').addEventListener('click', async function () {
    var btn = this;
    if (btn.classList.contains('loading')) return;
    if (!await confirmModal('모든 학생의 인증코드를 새로 만들까요?\n이미 나눠준 코드는 쓸 수 없게 돼요.', '인증코드 재발급', '재발급')) return;
    try {
      await Api.run(btn, async function () {
        codes = await t('tRegenCodes');
        renderCodes();
        msg($('codes-msg'), '✅ 새 인증코드를 만들었어요.', true);
      });
    } catch (err) { msg($('codes-msg'), '😢 ' + err.message); }
  });

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
        await loadCodes();
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
      var poem = r.lines ? poemHtml(r.manitoName, r.lines) : '<span class="tag n">아직 없음</span>';
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>' + (r.manitoName ? esc(r.manitoName) : '-') + '</td>' +
        '<td>' + (r.drawnAt ? '<span class="tag y">완료</span>' : '<span class="tag n">대기</span>') + '</td>' +
        '<td class="poem">' + poem + '</td><td>' + esc(Api.fmt(r.savedAt) || '-') + (r.count > 1 ? ' <small>(' + r.count + '회)</small>' : '') + '</td>' +
        '<td>' + (r.count ? '<button type="button" class="tag b" data-hist="' + i + '">기록</button>' : '') + '</td></tr>';
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
        return '<div class="hist"><small>' + esc(Api.fmt(h.at)) + (i === 0 ? ' · 최신' : '') + '</small>' + poemHtml(h.manitoName, h.lines) + '</div>';
      }).join('');
      $('modal').classList.remove('hidden');
    } catch (err) { msg($('result-msg'), '😢 ' + err.message); }
  });
  $('modal-close').addEventListener('click', function () { $('modal').classList.add('hidden'); });
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

  /* ----- 투표 ----- */
  var vote = null;
  async function loadVote() {
    try {
      vote = await t('tVoteGet');
      renderVote();
    } catch (err) { msg($('vote-msg'), '😢 ' + err.message); }
  }
  function renderVote() {
    $('vote-stat').innerHTML = '<span>' + (vote.open ? '🟢 투표 진행 중' : '⚪ 투표 대기/마감') + '</span><span>✏️ 투표 대상 삼행시 ' + vote.poems + '개</span><span>🗳️ 참여 ' + vote.voters + ' / ' + vote.students + '명</span>';
    var toggle = $('btn-vote-toggle');
    toggle.textContent = vote.open ? '⏹ 투표 마감' : '▶ 투표 시작';
    toggle.className = 'btn ' + (vote.open ? 'ghost' : 'coral');
    $('vote-picks').disabled = vote.open;
    if (vote.open || !$('vote-picks').dataset.touched) $('vote-picks').value = vote.picks;
  }
  $('vote-picks').addEventListener('input', function () { this.dataset.touched = '1'; });
  $('btn-vote-toggle').addEventListener('click', async function () {
    var btn = this;
    if (btn.classList.contains('loading')) return;
    var opening = !vote || !vote.open;
    var picks = parseInt($('vote-picks').value, 10);
    if (opening) {
      if (!picks || picks < 1) { msg($('vote-msg'), '😢 고를 삼행시 수를 1 이상으로 입력해 주세요.'); return; }
      if (!await confirmModal('학생이 삼행시 ' + picks + '개를 고르도록 투표를 시작할까요?\n학생 화면의 STEP 3 버튼이 열려요.', '투표 시작', '시작')) return;
    } else if (!await confirmModal('투표를 마감할까요?\n마감하면 학생들은 더 이상 투표하거나 고칠 수 없어요.', '투표 마감', '마감')) return;
    try {
      await Api.run(btn, async function () {
        vote = await t('tVoteSet', { open: opening, picks: picks });
        renderVote();
        msg($('vote-msg'), opening ? '✅ 투표를 시작했어요!' : '✅ 투표를 마감했어요.', true);
        if (!$('vote-result-wrap').classList.contains('hidden')) await loadVoteResults();
      });
    } catch (err) { msg($('vote-msg'), '😢 ' + err.message); }
  });
  async function loadVoteResults() {
    var r = await t('tVoteResults');
    var body = $('vote-body');
    body.innerHTML = r.items.map(function (x) {
      return '<tr><td><b>' + x.rank + '</b></td><td>' + esc(x.manitoName) + '</td><td class="poem">' + x.lines.map(esc).join('<br>') + '</td><td>' + esc(x.authorName) + '</td><td><b>' + x.votes + '</b></td></tr>';
    }).join('') || '<tr><td colspan="5">저장된 삼행시가 없어요.</td></tr>';
    $('vote-result-wrap').classList.remove('hidden');
    vote = await t('tVoteGet'); renderVote();
  }
  /* 결과 보기: 먼저 보는 방식을 물어봄 */
  $('btn-vote-results').addEventListener('click', function () {
    msg($('vote-msg'), '');
    $('vote-choice-modal').classList.remove('hidden');
  });
  function closeChoice() { $('vote-choice-modal').classList.add('hidden'); }
  $('vote-choice-cancel').addEventListener('click', closeChoice);
  $('vote-choice-modal').addEventListener('click', function (e) { if (e.target === $('vote-choice-modal')) closeChoice(); });
  $('vote-choice-list').addEventListener('click', function () {
    Api.run(this, async function () {
      try { await loadVoteResults(); closeChoice(); } catch (err) { closeChoice(); msg($('vote-msg'), '😢 ' + err.message); }
    });
  });
  $('vote-choice-top').addEventListener('click', function () {
    Api.run(this, async function () {
      try {
        var r = await t('tVoteResults');
        closeChoice();
        openPodium(r.items);
      } catch (err) { closeChoice(); msg($('vote-msg'), '😢 ' + err.message); }
    });
  });

  /* ----- 상위권 발표 (5위부터 차례로) ----- */
  var podItems = [], podOrder = [], podStep = 0;
  function medal(rank) { return ['', '🥇', '🥈', '🥉'][rank] || ''; } // 공동 순위는 같은 메달
  function podCardHtml(x) {
    return '<div class="pd-target">💝 ' + esc(x.manitoName) + '</div>' +
      '<div class="pd-lines">' + x.lines.map(esc).join('<br>') + '</div>' +
      '<div class="pd-meta"><b>' + x.votes + '표</b></div>' +
      '<div class="pd-author">' + esc(x.authorName) + '</div>';
  }
  function openPodium(items) {
    podItems = items.slice(0, 5);
    podOrder = podItems.map(function (_, i) { return i; }).reverse(); // 5위 → 1위
    podStep = 0;
    $('podium-modal').classList.remove('show-authors');
    $('podium-authors').textContent = '✍️ 작성자 보기';
    // 시상대: 2위 | 1위 | 3위 순서로 배치
    $('podium').innerHTML = [1, 0, 2].map(function (i) {
      if (!podItems[i]) return '';
      return '<div class="pd-col p' + (i + 1) + '" data-i="' + i + '"><div class="pd-card pd-hidden"><div class="pd-q">❓</div></div>' +
        '<div class="pd-block"><span>' + medal(podItems[i].rank) + '</span>' + podItems[i].rank + '위</div></div>';
    }).join('');
    $('podium-rest').innerHTML = [3, 4].map(function (i) {
      if (!podItems[i]) return '';
      return '<div class="pd-row pd-hidden" data-i="' + i + '"><span class="pd-rank">' + podItems[i].rank + '위</span><div class="pd-body">❓ 아직 비밀이에요</div></div>';
    }).join('');
    $('podium-rest').classList.toggle('hidden', !podItems[3]);
    $('podium-title').textContent = podItems.length ? '🏆 우수작 발표' : '아직 투표 결과가 없어요';
    updatePodiumBtn();
    $('podium-modal').classList.remove('hidden');
  }
  function updatePodiumBtn() {
    var btn = $('podium-next');
    if (podStep >= podOrder.length) { btn.textContent = '🎉 발표 끝!'; btn.disabled = true; $('podium-all').disabled = true; return; }
    btn.disabled = false; $('podium-all').disabled = false;
    btn.textContent = '▶ ' + podItems[podOrder[podStep]].rank + '위 발표';
  }
  function revealOne() {
    if (podStep >= podOrder.length) return;
    var i = podOrder[podStep++];
    var x = podItems[i];
    var el = i < 3 ? document.querySelector('.pd-col[data-i="' + i + '"] .pd-card') : document.querySelector('.pd-row[data-i="' + i + '"]');
    if (el) {
      if (i < 3) el.innerHTML = podCardHtml(x);
      else el.querySelector('.pd-body').innerHTML = podCardHtml(x);
      el.classList.remove('pd-hidden');
      el.classList.add('pd-pop');
      if (i === 0) confetti();
    }
    updatePodiumBtn();
  }
  $('podium-authors').addEventListener('click', function () {
    var on = $('podium-modal').classList.toggle('show-authors');
    this.textContent = on ? '✍️ 작성자 숨기기' : '✍️ 작성자 보기';
  });
  $('podium-next').addEventListener('click', revealOne);
  $('podium-all').addEventListener('click', function () { while (podStep < podOrder.length) revealOne(); });
  $('podium-restart').addEventListener('click', function () { openPodium(podItems); });
  $('podium-close').addEventListener('click', function () { $('podium-modal').classList.add('hidden'); });
  function confetti() {
    var emojis = ['🎉', '✨', '💖', '⭐', '🎈', '🏆', '🎊'];
    for (var i = 0; i < 40; i++) {
      var el = document.createElement('div');
      el.className = 'confetti';
      el.textContent = emojis[i % emojis.length];
      el.style.left = Math.random() * 100 + 'vw';
      el.style.animationDuration = 2 + Math.random() * 2 + 's';
      el.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.appendChild(el);
      setTimeout(function (x) { x.remove(); }, 5500, el);
    }
  }

  $('btn-vote-reset').addEventListener('click', async function () {
    var btn = this;
    if (btn.classList.contains('loading')) return;
    if (!await confirmModal('지금까지의 투표 기록을 모두 지울까요?\n(삼행시는 그대로 남아요)', '투표 기록 초기화', '초기화')) return;
    try {
      await Api.run(btn, async function () {
        await t('tVoteReset');
        msg($('vote-msg'), '✅ 투표 기록을 초기화했어요.', true);
        if (!$('vote-result-wrap').classList.contains('hidden')) await loadVoteResults(); else await loadVote();
      });
    } catch (err) { msg($('vote-msg'), '😢 ' + err.message); }
  });

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
