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
 *   '학생명단' : 학번 | 이름 | 마니또학번 | 마니또이름 | 뽑은시각
 *   '삼행시'   : 저장시각 | 학번 | 이름 | 마니또이름 | 삼행시(JSON)   ← 저장할 때마다 한 줄씩 누적
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
  tHistory: tHistory_
};
var WRITE_ACTIONS = { draw: 1, savePoem: 1, tSetStudents: 1, tShuffle: 1, tResetDraw: 1 };

/* ---------- 학생 기능 ---------- */

function login_(req) {
  var found = findStudent_(req);
  return {
    id: found.row[0],
    name: found.row[1],
    drawn: !!found.row[4]
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
  poemSheet_().appendRow([at, row[0], row[1], row[3], JSON.stringify(lines)]);
  return { savedAt: at };
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

// req.students = [[학번, 이름], ...]  (기존 명단을 통째로 교체. 마니또 배정/뽑기 기록은 초기화)
function tSetStudents_(req) {
  tAuth_(req);
  var seen = {};
  var rows = (req.students || []).map(function (s) {
    var id = String(s[0]).trim();
    var name = clean_(s[1]);
    if (!id || !name) throw new Error('학번/이름이 비어 있는 줄이 있어요.');
    if (seen[id]) throw new Error('학번이 중복되었어요: ' + id);
    seen[id] = true;
    return [id, name, '', '', ''];
  });
  var sh = studentSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
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
      return { sheet: studentSheet_(), index: i, row: rows[i] };
    }
  }
  throw new Error('학번과 이름이 명단과 맞지 않아요. 다시 확인해 주세요.');
}

function readStudents_() {
  var sh = studentSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().map(function (r) {
    return [String(r[0]).trim(), String(r[1]).trim(), String(r[2]).trim(), String(r[3]).trim(), r[4] ? String(r[4]) : ''];
  });
}

function readPoems_() {
  var sh = poemSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().map(function (r) {
    var lines = [];
    try { lines = JSON.parse(r[4]); } catch (e) {}
    return { at: String(r[0]), id: String(r[1]).trim(), name: String(r[2]), manitoName: String(r[3]), lines: lines };
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
  return sheet_(SHEET_STUDENTS, ['학번', '이름', '마니또학번', '마니또이름', '뽑은시각'], [1, 3]);
}

function poemSheet_() {
  return sheet_(SHEET_POEMS, ['저장시각', '학번', '이름', '마니또이름', '삼행시(JSON)'], [2]);
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
