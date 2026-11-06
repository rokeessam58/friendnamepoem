/**
 * 마니또 삼행시 - Google Apps Script 백엔드
 *
 * [설치]
 * 1) 구글 시트를 새로 만들고  확장 프로그램 > Apps Script  에 이 파일을 붙여넣기
 * 2) 프로젝트 설정(톱니바퀴) > 스크립트 속성 > 속성 추가
 *      TEACHER_PASSWORD = (교사 페이지 비밀번호)
 * 3) 배포 > 새 배포 > 유형: 웹 앱
 *      실행 계정: 나 / 액세스 권한: 모든 사용자
 *    → 발급된 웹 앱 URL(/exec)을 js/config.js 의 API_URL 에 붙여넣기
 * 4) 코드를 고치면 [배포 관리 > 수정 > 새 버전] 으로 다시 배포해야 반영됩니다.
 *
 * 시트는 처음 호출될 때 자동 생성됩니다.
 *   '학생명단' : 학번 | 이름 | 마니또학번 | 마니또이름 | 뽑은시각 | 인증코드(영문 대문자 5글자)
 *   '삼행시'   : 저장시각 | 학번 | 이름 | 마니또이름 | 삼행시   ← 저장할 때마다 한 줄씩 누적
 */

var SHEET_STUDENTS = '학생명단';
var SHEET_POEMS = '삼행시';
var TZ = 'Asia/Seoul';

function doGet() {
  return json_({ ok: true, message: 'manito-poem api' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var handler = ACTIONS[req.action];
    if (!handler) return json_({ ok: false, error: '알 수 없는 요청이에요.' });
    var isWrite = WRITE_ACTIONS[req.action];
    var lock = null;
    if (isWrite) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    try {
      return json_({ ok: true, data: handler(req) });
    } finally {
      if (lock) lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

/* ---------- 라우팅 ---------- */

var ACTIONS = {
  login: login_,
  draw: draw_,
  getPoem: getPoem_,
  savePoem: savePoem_,
  tCheck: tCheck_,
  tGetStudents: tGetStudents_,
  tSetStudents: tSetStudents_,
  tShuffle: tShuffle_,
  tResetDraw: tResetDraw_,
  tResults: tResults_,
  tHistory: tHistory_,
  tCodes: tCodes_,
  tRegenCodes: tRegenCodes_,
  voteStatus: voteStatus_,
  getBallot: getBallot_,
  submitVote: submitVote_,
  tVoteGet: tVoteGet_,
  tVoteSet: tVoteSet_,
  tVoteResults: tVoteResults_,
  tVoteReset: tVoteReset_
};
var WRITE_ACTIONS = { draw: 1, savePoem: 1, tSetStudents: 1, tShuffle: 1, tResetDraw: 1, submitVote: 1, tVoteSet: 1, tVoteReset: 1, tCodes: 1, tRegenCodes: 1 };

/* ---------- 학생 기능 ---------- */

function login_(req) {
  var found = findStudent_(req);
  return {
    id: found.row[0],
    name: found.row[1],
    drawn: !!found.row[4],
    vote: voteConfig_()
  };
}

function draw_(req) {
  var found = findStudent_(req);
  var row = found.row;
  if (!row[3]) throw new Error('아직 선생님이 마니또를 정하지 않았어요. 조금만 기다려 주세요!');
  if (!row[4]) {
    found.sheet.getRange(found.index + 2, 5).setValue(now_());
  }
  // names: 뽑기 연출(슬롯머신)용 반 친구 이름 목록
  return { manitoName: row[3], names: readStudents_().map(function (r) { return r[1]; }) };
}

function getPoem_(req) {
  var found = findStudent_(req);
  var row = found.row;
  if (!row[4]) throw new Error('먼저 마니또를 뽑아 주세요!');
  var latest = latestPoems_()[row[0]];
  return {
    manitoName: row[3],
    lines: latest ? latest.lines : null,
    savedAt: latest ? latest.at : null
  };
}

function savePoem_(req) {
  var found = findStudent_(req);
  var row = found.row;
  if (!row[4]) throw new Error('먼저 마니또를 뽑아 주세요!');
  var chars = Array.from(row[3]);
  var lines = req.lines;
  if (!Array.isArray(lines) || lines.length !== chars.length) throw new Error('삼행시 줄 수가 맞지 않아요.');
  lines = lines.map(function (s) { return String(s).slice(0, 200); });
  var at = now_();
  poemSheet_().appendRow([at, row[0], row[1], row[3], formatPoem_(chars, lines)]);
  return { savedAt: at };
}

/* ---------- 투표 (학생) ---------- */

// 투표 설정은 스크립트 속성에 보관: VOTE_OPEN('1'이면 진행 중), VOTE_PICKS(고를 개수)
function voteConfig_() {
  var p = PropertiesService.getScriptProperties();
  return { open: p.getProperty('VOTE_OPEN') === '1', picks: parseInt(p.getProperty('VOTE_PICKS'), 10) || 3 };
}

function voteStatus_(req) {
  findStudent_(req);
  return voteConfig_();
}

// 투표 대상 삼행시 목록: 저장된 삼행시를 '삼행시 대상(마니또)'의 명단 순서대로. 작성자는 담지 않음.
// key = 삼행시 대상(마니또)의 학번
function ballotPoems_() {
  var students = readStudents_();
  var latest = latestPoems_();
  var order = {};
  students.forEach(function (s, i) { order[s[0]] = i; });
  var list = [];
  students.forEach(function (s) {
    var p = latest[s[0]];
    if (!p || !s[2]) return;
    list.push({ key: s[2], authorId: s[0], authorName: s[1], manitoName: s[3], lines: p.lines, order: order[s[2]] });
  });
  list.sort(function (a, b) { return a.order - b.order; });
  return list;
}

function getBallot_(req) {
  var found = findStudent_(req);
  var cfg = voteConfig_();
  if (!cfg.open) throw new Error('아직 투표가 시작되지 않았어요.');
  var items = ballotPoems_().filter(function (p) { return p.authorId !== found.row[0]; }) // 내 삼행시는 제외
    .map(function (p) { return { key: p.key, manitoName: p.manitoName, lines: p.lines }; });
  return { picks: cfg.picks, items: items, selected: latestVotes_()[found.row[0]] || [] };
}

function submitVote_(req) {
  var found = findStudent_(req);
  var cfg = voteConfig_();
  if (!cfg.open) throw new Error('투표가 마감되었어요.');
  var keys = (req.keys || []).map(String);
  var uniq = {};
  keys.forEach(function (k) { uniq[k] = 1; });
  if (Object.keys(uniq).length !== keys.length) throw new Error('같은 삼행시를 두 번 고를 수 없어요.');
  if (keys.length !== cfg.picks) throw new Error('삼행시를 정확히 ' + cfg.picks + '개 골라 주세요.');
  var allowed = {};
  ballotPoems_().forEach(function (p) { if (p.authorId !== found.row[0]) allowed[p.key] = 1; });
  keys.forEach(function (k) { if (!allowed[k]) throw new Error('고를 수 없는 삼행시가 포함되어 있어요.'); });
  voteSheet_().appendRow([now_(), found.row[0], found.row[1], keys.join(' / ')]);
  return { picks: cfg.picks };
}

// 학번별 가장 최근 투표 { 학번: [key, ...] }
function latestVotes_() {
  var sh = voteSheet_();
  var map = {};
  if (sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    map[String(r[1]).trim()] = String(r[3]).split('/').map(function (x) { return x.trim(); }).filter(Boolean);
  });
  return map;
}

/* ---------- 투표 (교사) ---------- */

function tVoteGet_(req) {
  tAuth_(req);
  var cfg = voteConfig_();
  return { open: cfg.open, picks: cfg.picks, voters: Object.keys(latestVotes_()).length, students: readStudents_().length, poems: ballotPoems_().length };
}

// req.open(true/false), req.picks(시작할 때 고를 개수)
function tVoteSet_(req) {
  tAuth_(req);
  var p = PropertiesService.getScriptProperties();
  if (req.open) {
    var picks = parseInt(req.picks, 10);
    var total = ballotPoems_().length;
    if (!picks || picks < 1) throw new Error('고를 개수는 1 이상이어야 해요.');
    if (total < 2) throw new Error('저장된 삼행시가 2개 이상 있어야 투표를 시작할 수 있어요.');
    if (picks > total - 1) throw new Error('고를 개수가 투표 대상(최대 ' + (total - 1) + '개)보다 많아요.');
    p.setProperty('VOTE_PICKS', String(picks));
    p.setProperty('VOTE_OPEN', '1');
  } else {
    p.setProperty('VOTE_OPEN', '');
  }
  return tVoteGet_(req);
}

function tVoteResults_(req) {
  tAuth_(req);
  var counts = {};
  var votes = latestVotes_();
  Object.keys(votes).forEach(function (id) { votes[id].forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
  var list = ballotPoems_().map(function (p) {
    return { manitoName: p.manitoName, authorName: p.authorName, lines: p.lines, votes: counts[p.key] || 0, order: p.order };
  });
  list.sort(function (a, b) { return b.votes - a.votes || a.order - b.order; });
  var rank = 0, prev = null;
  list.forEach(function (x, i) { if (x.votes !== prev) { rank = i + 1; prev = x.votes; } x.rank = rank; });
  return { voters: Object.keys(votes).length, items: list };
}

function tVoteReset_(req) {
  tAuth_(req);
  var sh = voteSheet_();
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  return true;
}

/* ---------- 교사 기능 ---------- */

function tAuth_(req) {
  var pw = PropertiesService.getScriptProperties().getProperty('TEACHER_PASSWORD');
  if (!pw) throw new Error('스크립트 속성에 TEACHER_PASSWORD 가 설정되지 않았어요.');
  if (String(req.password || '') !== pw) throw new Error('비밀번호가 맞지 않아요.');
}

function tCheck_(req) {
  tAuth_(req);
  return true;
}

function tGetStudents_(req) {
  tAuth_(req);
  return readStudents_().map(function (r) { return [r[0], r[1]]; });
}

// 인증코드 목록 [[학번, 이름, 코드]]. 코드가 비어 있는 학생이 있으면 이때 채워 넣음
function tCodes_(req) {
  tAuth_(req);
  var sh = studentSheet_();
  var rows = readStudents_();
  var used = {};
  rows.forEach(function (r) { if (r[5]) used[r[5]] = 1; });
  rows.forEach(function (r, i) {
    if (!r[5]) { r[5] = newCode_(used); sh.getRange(i + 2, 6).setValue(r[5]); }
  });
  return rows.map(function (r) { return [r[0], r[1], r[5]]; });
}

// 전체 인증코드 재발급
function tRegenCodes_(req) {
  tAuth_(req);
  var sh = studentSheet_();
  var n = readStudents_().length;
  var used = {};
  var codes = [];
  for (var i = 0; i < n; i++) codes.push([newCode_(used)]);
  if (n) sh.getRange(2, 6, n, 1).setValues(codes);
  return tCodes_(req);
}

// 무작위 영문 대문자 5글자 (중복 없이)
function newCode_(used) {
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', c;
  do {
    c = '';
    for (var i = 0; i < 5; i++) c += A.charAt(Math.floor(Math.random() * 26));
  } while (used[c]);
  used[c] = 1;
  return c;
}

// req.students = [[학번, 이름], ...]  (기존 명단을 통째로 교체. 마니또 배정/뽑기 기록은 초기화)
function tSetStudents_(req) {
  tAuth_(req);
  var seen = {};
  var oldCodes = {}; // 같은 학번은 기존 인증코드를 그대로 유지
  readStudents_().forEach(function (r) { if (r[5]) oldCodes[r[0]] = r[5]; });
  var used = {};
  Object.keys(oldCodes).forEach(function (k) { used[oldCodes[k]] = 1; });
  var rows = (req.students || []).map(function (s) {
    var id = String(s[0]).trim();
    var name = clean_(s[1]);
    if (!id || !name) throw new Error('학번/이름이 비어 있는 줄이 있어요.');
    if (seen[id]) throw new Error('학번이 중복되었어요: ' + id);
    seen[id] = true;
    return [id, name, '', '', '', oldCodes[id] || newCode_(used)];
  });
  var sh = studentSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 6).setValues(rows);
  return rows.length;
}

// 자기 자신을 뽑지 않도록 섞어서 저장 (뽑기 기록은 초기화)
function tShuffle_(req) {
  tAuth_(req);
  var students = readStudents_();
  var n = students.length;
  if (n < 2) throw new Error('학생이 2명 이상 등록되어야 해요.');
  var perm;
  do {
    perm = shuffle_(range_(n));
  } while (perm.some(function (v, i) { return v === i; }));
  var out = students.map(function (s, i) {
    var m = students[perm[i]];
    return [s[0], s[1], m[0], m[1], ''];
  });
  studentSheet_().getRange(2, 1, n, 5).setValues(out);
  return n;
}

function tResetDraw_(req) {
  tAuth_(req);
  var sh = studentSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 5, sh.getLastRow() - 1, 1).clearContent();
  return true;
}

function tResults_(req) {
  tAuth_(req);
  var latest = latestPoems_();
  var counts = poemCounts_();
  return readStudents_().map(function (r) {
    var p = latest[r[0]];
    return {
      id: r[0], name: r[1], manitoId: r[2], manitoName: r[3], drawnAt: r[4],
      lines: p ? p.lines : null, savedAt: p ? p.at : null, count: counts[r[0]] || 0
    };
  });
}

function tHistory_(req) {
  tAuth_(req);
  var id = String(req.id);
  return readPoems_().filter(function (p) { return p.id === id; }).reverse();
}

/* ---------- 헬퍼 ---------- */

function findStudent_(req) {
  var id = String(req.id || '').trim();
  var name = clean_(req.name);
  var rows = readStudents_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === id && clean_(rows[i][1]) === name) {
      if (!rows[i][5]) throw new Error('아직 인증코드가 만들어지지 않았어요. 선생님께 알려 주세요.');
      if (clean_(req.code).toUpperCase() !== rows[i][5]) throw new Error('인증코드가 맞지 않아요. 다시 확인해 주세요.');
      return { sheet: studentSheet_(), index: i, row: rows[i] };
    }
  }
  throw new Error('학번, 이름, 인증코드가 명단과 맞지 않아요. 다시 확인해 주세요.');
}

function readStudents_() {
  var sh = studentSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().map(function (r) {
    return [String(r[0]).trim(), String(r[1]).trim(), String(r[2]).trim(), String(r[3]).trim(), r[4] ? String(r[4]) : '', String(r[5] || '').trim().toUpperCase()];
  });
}

function readPoems_() {
  var sh = poemSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().map(function (r) {
    var lines = parsePoem_(r[4]);
    return { at: fmt_(r[0]), id: String(r[1]).trim(), name: String(r[2]), manitoName: String(r[3]), lines: lines };
  });
}

// 시트 저장 형식: 줄마다 "글자: 내용" (줄바꿈으로 구분)
function formatPoem_(chars, lines) {
  return lines.map(function (l, i) { return chars[i] + ': ' + l; }).join('\n');
}

// 위 형식을 줄 배열로 복원 (예전에 JSON 배열로 저장된 기록도 읽을 수 있게 함)
function parsePoem_(cell) {
  var t = String(cell || '');
  if (t.charAt(0) === '[') {
    try { var arr = JSON.parse(t); if (Array.isArray(arr)) return arr; } catch (e) {}
  }
  if (!t) return [];
  return t.split('\n').map(function (line) {
    return Array.from(line).slice(1).join('').replace(/^: ?/, '');
  });
}

// 학번별 가장 최근 저장본 (시트에 쌓이는 순서 = 시간순)
function latestPoems_() {
  var map = {};
  readPoems_().forEach(function (p) { map[p.id] = p; });
  return map;
}

function poemCounts_() {
  var map = {};
  readPoems_().forEach(function (p) { map[p.id] = (map[p.id] || 0) + 1; });
  return map;
}

function studentSheet_() {
  var sh = sheet_(SHEET_STUDENTS, ['학번', '이름', '마니또학번', '마니또이름', '뽑은시각', '인증코드'], [1, 3, 6]);
  if (sh.getRange(1, 6).getValue() !== '인증코드') { // 예전에 만든 시트에는 인증코드 열을 덧붙임
    sh.getRange(1, 6).setValue('인증코드').setFontWeight('bold').setBackground('#ffe9a8');
    sh.getRange(2, 6, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  }
  return sh;
}

function poemSheet_() {
  return sheet_(SHEET_POEMS, ['저장시각', '학번', '이름', '마니또이름', '삼행시'], [2]);
}

function voteSheet_() {
  return sheet_('투표', ['투표시각', '학번', '이름', '고른 삼행시(대상 학번)'], [2, 4]);
}

function sheet_(name, header, textCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#ffe9a8');
    sh.setFrozenRows(1);
    textCols.forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); }); // 학번 앞자리 0/숫자 변환 방지
  }
  return sh;
}

function clean_(s) { return String(s || '').replace(/\s+/g, ''); }
// 시트가 날짜로 자동 변환한 셀도 보기 좋게: yyyy. MM. dd. HH:mm:ss
function fmt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy. MM. dd. HH:mm:ss');
  return String(v);
}
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function range_(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
function shuffle_(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
