# Cloudflare Pages 자동 배포 가이드

> **전제**: GitHub에 리포지토리가 이미 푸시되어 있다고 가정 (`main` 브랜치 기준)

---

## 1. Cloudflare Pages와 GitHub 연동

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) 로그인
2. 좌측 메뉴 **Workers & Pages** → **Pages** → **Create a project**
3. **Connect to Git** 선택 → **GitHub** 클릭
4. 권한 허용 후 리포지토리 목록에서 `Payroll-Management-App` 선택 → **Begin setup**

### 빌드 설정 (자동 감지되니 그대로 두세요)

| 설정 | 값 | 비고 |
|------|-----|------|
| **Project name** | `payroll-app` | 원하는 이름으로 변경 가능 |
| **Production branch** | `main` | 기본값 |
| **Framework preset** | `None` | 바닐라 JS라 불필요 |
| **Build command** | *(비움)* | 빌드 과정 없음 |
| **Build output directory** | `.` | 루트 디렉토리 (`index.html` 위치) |
| **Root directory** | `/` | 기본값 |

5. **Save and Deploy** 클릭
6. 최초 배포 완료까지 1~2분 소요 → `https://payroll-app.pages.dev` 접속 확인

---

## 2. Preview Deployments 활성화 (강력 추천)

> **PR을 올릴 때마다 임시 배포 URL이 자동 생성되어 테스트 가능**

1. Pages 프로젝트 진입 → **Settings** → **Build & deployments**
2. **Preview deployments** 섹션에서 **Enable preview deployments** 체크
3. **Branch preview deployments** → `All branches` 선택 (또는 `main`만)
4. **Save** 클릭

**결과**: PR 생성 시 자동으로 `https://<해시>.payroll-app.pages.dev` 형태의 미리보기 URL 생성됨

---

## 3. 이후 유지보수 워크플로우

### 일상적인 배포 (main 브랜치 직접 푸시)
```bash
# 로컬에서 수정 후
git add .
git commit -m "Fix: 급여일 계산 로직 개선"
git push origin main
```
→ **자동으로 프로덕션 배포 실행** (약 1분 후 반영)

### 기능 개발/협업 시 (PR 기반)
```bash
# 1. 기능 브랜치 생성
git checkout -b feat/add-category

# 2. 개발 및 커밋
git add .
git commit -m "Feat: 카테고리 커스텀 추가"

# 3. 푸시 및 PR 생성
git push origin feat/add-category
# → GitHub에서 "Compare & pull request" 클릭 → PR 생성
```
→ **자동으로 Preview URL 생성** (PR 페이지 하단 "Deploy preview" 링크)
→ 리뷰/테스트 후 **Merge** → **자동으로 프로덕션 배포**

### 긴급 수정 (Hotfix)
```bash
git checkout -b hotfix/fix-balance-calc main
# 수정 커밋
git push origin hotfix/fix-balance-calc
# PR 생성 → 테스트 → Merge
```

---

## 4. 확인 포인트 체크리스트

배포 후 반드시 확인하세요:

- [ ] `https://payroll-app.pages.dev` 접속 시 앱 정상 로드
- [ ] **PWA 설치** 가능 (브라우저 주소창 옆 설치 아이콘 또는 메뉴 → "앱 설치")
- [ ] **오프라인 동작** (개발자 도구 → Application → Service Workers → Offline 체크 후 새로고침)
- [ ] **데이터 지속성** (지출 추가 → 새로고침/재방문 시 데이터 유지)
- [ ] Preview URL에서 기능 테스트 후 Merge

---

## 5. 자주 묻는 상황

### 커스텀 도메인 연결
1. 프로젝트 → **Settings** → **Custom domains** → **Set up a custom domain**
2. 도메인 입력 → 안내되는 CNAME 레코드를 본인 DNS에 추가
3. 자동으로 SSL 인증서 발급 완료

### 환경변수 필요 시 (API 키 등)
1. 프로젝트 → **Settings** → **Environment variables** → **Add variable**
2. `KEY=VALUE` 형태로 추가 (빌드 시 `import.meta.env.KEY`로 접근 가능)

### 캐시 강제 갱신 (SW 업데이트 안 될 때)
`sw.js` 상단에 버전 주석 추가 후 푸시:
```js
// sw.js
const CACHE_VERSION = 'v2'; // 버전 올리기
// ...
```
또는 `index.html`에서 등록 경로 변경:
```html
<script>
  navigator.serviceWorker.register('sw.js?v=2')
</script>
```

### 리다이렉트/헤더 설정
프로젝트 루트에 파일 생성:
- `_redirects` — SPA 라우팅용: `/* /index.html 200`
- `_headers` — 보안 헤더: `X-Frame-Options: DENY` 등

---

## 6. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| **빌드 실패** | Build command/output dir 오타 | Settings에서 `.` 확인 |
| **404 에러** | `index.html`이 루트에 없음 | 루트 구조 확인 |
| **SW 미등록** | HTTPS 아님 / 경로 오류 | Pages는 HTTPS 자동, `sw.js` 루트 확인 |
| **Preview URL 안 생김** | Preview deployments 비활성화 | Settings → Enable 체크 |

---

## 7. 한 줄 요약

> **`git push origin main`만 하면 끝.**  
> PR 올리면 미리보기 URL 자동 생성, Merge하면 프로덕션 반영.

---

**끝.** 이제 코드만 짜세요. 배포는 Git이 알아서 합니다. 🚀