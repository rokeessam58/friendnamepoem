(function () {
  var $ = function (id) { return document.getElementById(id); };
  var user = null;       // {id, name, drawn}
  var manito = '';       // 마니또 이름 (뽑은 뒤)

  var screens = ['s-boot', 's-login', 's-menu', 's-draw', 's-poem'];
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
  $('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button');
    msg($('login-msg'), '');
    try {
      await Api.run(btn, async function () {
        var r = await Api.call('login', { id: $('in-id').value.trim(), name: $('in-name').value.trim() });
        user = r;
        try { sessionStorage.setItem('manito_user', JSON.stringify({ id: r.id, name: r.name })); } catch (e2) {}
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
  }

  /* ----- 뽑기 ----- */
  $('btn-draw').addEventListener('click', async function () {
    msg($('menu-msg'), '');
    var res;
    try {
      // 서버 응답을 받는 동안 버튼에 로딩 표시 → 받은 뒤에 뽑기 화면으로 전환
      res = await Api.run(this, function () { return Api.call('draw', { id: user.id, name: user.name }); });
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
        var r = await Api.call('getPoem', { id: user.id, name: user.name });
        manito = r.manitoName;
        buildBoard(Array.from(manito), r.lines);
        $('save-info').textContent = r.savedAt ? '마지막 저장: ' + r.savedAt : '글자 옆 칸을 마음껏 고쳐 쓰세요.';
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
        var r = await Api.call('savePoem', { id: user.id, name: user.name, lines: lines });
        $('save-info').textContent = '마지막 저장: ' + r.savedAt;
        msg($('poem-msg'), '🎉 저장했어요! 언제든 다시 고칠 수 있어요.', true);
      });
    } catch (err) {
      msg($('poem-msg'), '😢 ' + err.message);
    }
  });
  $('btn-poem-back').addEventListener('click', logout);
})();
