(function () {
  var $ = function (id) { return document.getElementById(id); };
  var user = null;       // {id, name, drawn}
  var manito = '';       // 마니또 이름 (뽑은 뒤)

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var screens = ['s-boot', 's-login', 's-menu', 's-draw', 's-poem', 's-vote'];
  function show(id) {
    screens.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    window.scrollTo(0, 0);
  }
  function msg(el, text, ok) {
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
    el.classList.toggle('ok', !!ok);
  }

  if (Api.isDemo) $('demo-note').classList.remove('hidden');

  /* ----- 로그인 ----- */
  // 인증코드 칸: 영문 대문자만 입력되게 (한글·숫자·기호·공백은 바로 지워짐)
  function onlyUpper() {
    var v = this.value.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (v !== this.value) this.value = v;
  }
  $('in-code').addEventListener('input', onlyUpper);
  $('in-code').addEventListener('compositionend', onlyUpper);

  $('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button');
    msg($('login-msg'), '');
    try {
      await Api.run(btn, async function () {
        var cred = { id: $('in-id').value.trim(), name: $('in-name').value.trim(), code: $('in-code').value.trim().toUpperCase() };
        var r = await Api.call('login', cred);
        user = r;
        user.code = cred.code;
        try { sessionStorage.setItem('manito_user', JSON.stringify({ id: r.id, name: r.name, code: cred.code })); } catch (e2) {}
        enterMenu();
      });
    } catch (err) {
      msg($('login-msg'), '😢 ' + err.message);
    }
  });

  // 나가기: 로그인 정보를 지우고 학번·이름 입력 화면으로 돌아감
  function logout() {
    user = null; manito = '';
    try { sessionStorage.removeItem('manito_user'); } catch (e) {}
    $('login-form').reset();
    msg($('login-msg'), '');
    msg($('menu-msg'), '');
    msg($('poem-msg'), '');
    $('poem-board').innerHTML = '';
    $('vote-list').innerHTML = '';
    msg($('vote-msg2'), '');
    show('s-login');
  }
  $('btn-logout').addEventListener('click', logout);

  // 새로고침해도 로그인 유지
  (async function restore() {
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('manito_user')); } catch (e) {}
    if (!saved) return;
    show('s-boot'); // 확인하는 동안 로그인 폼이 깜빡이지 않도록 로딩 화면 표시
    try {
      user = await Api.call('login', saved);
      user.code = saved.code;
      enterMenu();
    } catch (e) {
      try { sessionStorage.removeItem('manito_user'); } catch (e2) {}
      show('s-login');
    }
  })();

  /* ----- 메뉴 ----- */
  // 성을 떼고 이름만 부르기: 박지호 → 지호야 / 김민준 → 민준아 (받침 있으면 '아', 없으면 '야')
  function callName(full) {
    var chars = Array.from(String(full).trim());
    var given = chars.length >= 3 ? chars.slice(-2) : chars.length === 2 ? chars.slice(-1) : chars;
    var last = given[given.length - 1] || '';
    var code = last.charCodeAt(0);
    var isHangul = code >= 0xAC00 && code <= 0xD7A3;
    var hasBatchim = isHangul && (code - 0xAC00) % 28 !== 0;
    return { name: given.join(''), suffix: hasBatchim ? '아' : '야' };
  }

  function enterMenu() {
    var cn = callName(user.name);
    $('hello-name').textContent = cn.name;      // 형광펜은 이름에만
    $('hello-suffix').textContent = cn.suffix;  // 아/야는 형광펜 없이
    refreshMenu();
    msg($('menu-msg'), '');
    show('s-menu');
  }
  function refreshMenu() {
    var drawn = user.drawn;
    $('btn-poem').disabled = !drawn;
    $('poem-sub').textContent = drawn ? '내 마니또의 이름으로 마음을 전해요' : '먼저 마니또를 뽑아야 열려요';
    $('draw-sub').textContent = drawn ? '다시 한번 확인해 볼까요?' : '두근두근, 누구일까요?';
    var open = !!(user.vote && user.vote.open);
    $('btn-vote').disabled = !open;
    $('vote-sub').textContent = open ? '마음에 드는 삼행시를 골라요' : '선생님이 투표를 시작하면 열려요';
  }
  // 메뉴 화면이 열려 있는 동안 투표 시작/마감을 주기적으로 확인
  setInterval(async function () {
    if (!user || $('s-menu').classList.contains('hidden')) return;
    try {
      user.vote = await Api.call('voteStatus', { id: user.id, name: user.name, code: user.code });
      if (!$('s-menu').classList.contains('hidden')) refreshMenu();
    } catch (e) {}
  }, 15000);

  /* ----- 뽑기 ----- */
  $('btn-draw').addEventListener('click', async function () {
    msg($('menu-msg'), '');
    var res;
    try {
      // 서버 응답을 받는 동안 버튼에 로딩 표시 → 받은 뒤에 뽑기 화면으로 전환
      res = await Api.run(this, function () { return Api.call('draw', { id: user.id, name: user.name, code: user.code }); });
    } catch (err) {
      msg($('menu-msg'), '😢 ' + err.message);
      return;
    }
    if (!res) return;
    show('s-draw');
    $('draw-stage').classList.remove('hidden');
    $('draw-after').classList.add('hidden');
    $('btn-draw-back').classList.add('hidden');
    $('draw-hint').textContent = '두구두구두구…';
    var spin = $('spin');
    spin.classList.remove('pop');
    spin.textContent = '???';
    {
      manito = res.manitoName;
      // 슬롯머신: 실제 반 친구 이름이 빠르게 바뀌다가 점점 느려지며 멈춤
      var others = (res.names || []).filter(function (n) { return n !== user.name; }); // 본인 이름 제외
      var pool = others.length > 1 ? others : [manito];
      var last = '';
      var steps = 24;
      for (var i = 0; i < steps; i++) {
        var pick;
        do { pick = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && pick === last);
        last = pick;
        spin.textContent = pick;
        await new Promise(function (r) { setTimeout(r, 60 + i * i * 0.6); });
      }
      user.drawn = true;
      spin.textContent = manito;
      spin.classList.add('pop');
      $('draw-hint').textContent = '🎉 짜잔! 나의 마니또는 바로 이 친구예요!';
      $('draw-after').classList.remove('hidden');
      confetti();
    }
    $('btn-draw-back').classList.remove('hidden');
  });
  $('btn-draw-back').addEventListener('click', logout);
  $('btn-go-poem').addEventListener('click', openPoem);
  $('btn-poem').addEventListener('click', openPoem);

  function confetti() {
    var emojis = ['🎉', '✨', '💖', '⭐', '🎈', '🍀', '🎊'];
    for (var i = 0; i < 28; i++) {
      var el = document.createElement('div');
      el.className = 'confetti';
      el.textContent = emojis[i % emojis.length];
      el.style.left = Math.random() * 100 + 'vw';
      el.style.animationDuration = 2 + Math.random() * 2 + 's';
      el.style.animationDelay = Math.random() * 0.6 + 's';
      document.body.appendChild(el);
      setTimeout(function (x) { x.remove(); }, 5000, el);
    }
  }

  /* ----- 삼행시 ----- */
  async function openPoem(e) {
    msg($('poem-msg'), '');
    msg($('menu-msg'), '');
    try {
      await Api.run(e.currentTarget, async function () {
        var r = await Api.call('getPoem', { id: user.id, name: user.name, code: user.code });
        manito = r.manitoName;
        buildBoard(Array.from(manito), r.lines);
        $('save-info').textContent = r.savedAt ? '마지막 저장: ' + Api.fmt(r.savedAt) : '';
        show('s-poem');
      });
    } catch (err) {
      msg($('menu-msg'), '😢 ' + err.message);
      show('s-menu');
    }
  }

  function buildBoard(chars, lines) {
    var board = $('poem-board');
    board.innerHTML = '';
    chars.forEach(function (ch, i) {
      var c = document.createElement('div');
      c.className = 'char c' + (i % 5);
      c.textContent = ch;
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'poem-input';
      input.maxLength = 120;
      input.dataset.idx = i;
      input.value = lines && lines[i] != null ? lines[i] : ch; // 처음엔 글자가 미리 입력됨
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          var next = board.querySelector('input[data-idx="' + (i + 1) + '"]');
          if (next) next.focus(); else $('btn-save').focus();
        }
      });
      board.appendChild(c);
      board.appendChild(input);
    });
    // 첫 입력칸 끝에 커서
    var first = board.querySelector('input');
    if (first) { first.focus(); first.setSelectionRange(first.value.length, first.value.length); }
  }

  $('btn-save').addEventListener('click', async function () {
    var btn = $('btn-save');
    var lines = Array.prototype.map.call(document.querySelectorAll('.poem-input'), function (i) { return i.value; });
    msg($('poem-msg'), '');
    try {
      await Api.run(btn, async function () {
        var r = await Api.call('savePoem', { id: user.id, name: user.name, code: user.code, lines: lines });
        $('save-info').textContent = '마지막 저장: ' + Api.fmt(r.savedAt);
        msg($('poem-msg'), '🎉 저장했어요! 언제든 다시 고칠 수 있어요.', true);
      });
    } catch (err) {
      msg($('poem-msg'), '😢 ' + err.message);
    }
  });
  // 돌아가기: STEP 1·2·3 버튼이 있는 메뉴로
  function backToMenu() { msg($('poem-msg'), ''); msg($('vote-msg2'), ''); refreshMenu(); show('s-menu'); }
  $('btn-poem-back').addEventListener('click', backToMenu);
  $('btn-vote-back').addEventListener('click', backToMenu);

  /* ----- 투표 ----- */
  var picked = [], picksNeeded = 0;
  $('btn-vote').addEventListener('click', async function () {
    msg($('menu-msg'), '');
    try {
      await Api.run(this, async function () {
        var r = await Api.call('getBallot', { id: user.id, name: user.name, code: user.code });
        picksNeeded = r.picks;
        picked = r.selected.filter(function (k) { return r.items.some(function (x) { return x.key === k; }); });
        buildVote(r.items);
        $('vote-lead').textContent = '마음에 드는 삼행시를 ' + r.picks + '개 골라 주세요!';
        updateVoteBar();
        msg($('vote-msg2'), r.selected.length ? '이미 투표했어요. 다시 골라서 제출하면 바뀌어요.' : '', true);
        show('s-vote');
      });
    } catch (err) {
      msg($('menu-msg'), '😢 ' + err.message);
      try { user.vote = await Api.call('voteStatus', { id: user.id, name: user.name, code: user.code }); } catch (e) {}
      refreshMenu();
    }
  });
  function buildVote(items) {
    var list = $('vote-list');
    list.innerHTML = '';
    items.forEach(function (it) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'vote-card' + (picked.indexOf(it.key) >= 0 ? ' on' : '');
      var chars = Array.from(it.manitoName);
      var html = '<div class="vc-title">💝 ' + esc(it.manitoName) + '</div><span class="vc-check"></span>';
      it.lines.forEach(function (l, i) {
        html += '<div class="vc-line"><span class="vc-char">' + esc(chars[i] || '') + '</span><span>' + esc(l) + '</span></div>';
      });
      card.innerHTML = html;
      card.addEventListener('click', function () {
        var at = picked.indexOf(it.key);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length >= picksNeeded) { msg($('vote-msg2'), '😅 ' + picksNeeded + '개까지만 고를 수 있어요. 다른 걸 취소하고 골라 주세요.'); return; }
        else picked.push(it.key);
        msg($('vote-msg2'), '');
        card.classList.toggle('on', picked.indexOf(it.key) >= 0);
        updateVoteBar();
      });
      list.appendChild(card);
    });
  }
  function updateVoteBar() {
    $('vote-count').textContent = picked.length + ' / ' + picksNeeded + '개 선택';
    $('vote-count').parentNode.classList.toggle('full', picked.length === picksNeeded);
    $('btn-vote-submit').disabled = picked.length !== picksNeeded;
  }
  $('btn-vote-submit').addEventListener('click', async function () {
    msg($('vote-msg2'), '');
    try {
      await Api.run(this, async function () {
        await Api.call('submitVote', { id: user.id, name: user.name, code: user.code, keys: picked });
        msg($('vote-msg2'), '🎉 투표했어요! 투표가 끝나기 전까지는 다시 고칠 수 있어요.', true);
      });
    } catch (err) {
      msg($('vote-msg2'), '😢 ' + err.message);
    }
  });
})();
