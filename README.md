# 마니또 삼행시

정적 프론트엔드(HTML/CSS/JS) + 구글 시트 GAS 백엔드.

## 로컬 실행
```
python -m http.server 5173
```
`js/config.js` 의 `API_URL` 이 비어 있으면 **데모 모드**(브라우저 localStorage)로 동작합니다. 교사 데모 비밀번호는 `1234`.

## 배포 순서
1. 구글 시트 생성 → 확장 프로그램 → Apps Script → `gas/Code.gs` 붙여넣기
2. 프로젝트 설정 → 스크립트 속성 → `TEACHER_PASSWORD` 추가
3. 배포 → 새 배포 → 웹 앱 (실행 계정: 나 / 액세스: 모든 사용자) → `/exec` URL 복사
4. `js/config.js` 의 `API_URL` 에 붙여넣기
5. GitHub 저장소에 올리고 Settings → Pages → Branch: main / root
   - 학생: `https://<id>.github.io/<repo>/`
   - 교사: `https://<id>.github.io/<repo>/teacher.html`

GAS 코드를 수정하면 **배포 관리 → 새 버전**으로 다시 배포해야 반영됩니다.

## 시트 구조 (자동 생성)
- `학생명단`: 학번 | 이름 | 마니또학번 | 마니또이름 | 뽑은시각
- `삼행시`: 저장시각 | 학번 | 이름 | 마니또이름 | 삼행시 — 저장할 때마다 누적, 화면에는 최신본만 표시
- `투표`: 투표시각 | 학번 | 이름 | 고른 삼행시(대상 학번) — 학생별 가장 최근 투표만 집계. 투표 시작/마감과 고를 개수는 스크립트 속성(`VOTE_OPEN`, `VOTE_PICKS`)에 저장돼요 (교사 페이지 ④ 투표 탭에서 조작)
