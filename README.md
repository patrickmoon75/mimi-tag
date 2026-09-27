# 미미태그 (mimi-tag)

작은 QR 스티커 하나로 물건의 **구매증명 · 선물 편지 · 분실 시 안심 연락**을 기록하고,
일정 기간 뒤 **봉인**하며, 물건이 넘어가면 기록을 **승계**하는 모바일 웹앱.

> 비공개 프로젝트입니다. 통합 특허 출원 전까지 외부에 공개하지 마세요.

- 설계: [`docs/design.md`](docs/design.md)
- DB 스키마: [`supabase/migrations/`](supabase/migrations)
- 태그 코드 체계: [`src/lib/tagcode.ts`](src/lib/tagcode.ts)

## 구성

| 영역 | 기술 |
|---|---|
| 웹앱 | Next.js 15 (App Router) · TypeScript · 모바일 웹 |
| 배포 | Vercel (서울 `icn1`) |
| DB·로그인·사진 | Supabase (서울 `ap-northeast-2`) · 카카오 로그인 |
| AI 편지 초안 | Anthropic API (서버에서만 호출) |

## 처음 설정하기 (한 번만)

### 1. Supabase

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성. **Region: Northeast Asia (Seoul)**.
2. SQL Editor 에서 아래 두 파일 내용을 순서대로 실행:
   - `supabase/migrations/20260927000001_init.sql`
   - `supabase/migrations/20260927000002_storage.sql`
3. Project Settings → API 에서 `URL`, `anon key`, `service_role key` 를 복사해 둔다.

### 2. 카카오 로그인

1. [developers.kakao.com](https://developers.kakao.com) → 애플리케이션 추가.
2. 앱 키의 **REST API 키**(= Client ID), 카카오 로그인 → 보안의 **Client Secret** 발급·활성화.
3. 카카오 로그인 활성화 ON, Redirect URI 에 `https://<프로젝트>.supabase.co/auth/v1/callback` 등록.
4. 동의항목: 닉네임(필수), 프로필 사진(선택). 이메일은 비즈 앱(또는 '개인 등록') 이 필요하므로 MVP 에서는 받지 않는다.
5. Supabase → Authentication → Providers → Kakao 에 Client ID/Secret 입력, **Allow users without an email** 켜기.
6. Supabase → Authentication → URL Configuration 에 사이트 주소와 `https://<사이트>/auth/callback` 추가.

### 3. Vercel

1. [vercel.com](https://vercel.com) 에서 GitHub 저장소 `mimi-tag` 가져오기(Import).
2. Environment Variables 에 `.env.example` 의 항목을 채워 넣기. `SUPABASE_SERVICE_ROLE_KEY` 는 절대 공개하지 않는다.
3. Settings → Functions → Region 을 **Seoul (icn1)** 로.
4. 비공개 개발 중에는 Hobby, **판매를 시작하면 Pro 로 전환**(Hobby 는 비상업 용도만 허용).

## 태그 발급

```bash
npm install
cp .env.example .env.local   # 값 채우기
npx tsx --env-file=.env.local scripts/issue-batch.ts --type S --qty 100 --product "샘플 100" --target 자체
```

`output/batch-<번호>-S-100.csv` 에 `code,url` 이 저장됩니다. 라벨 프린터 프로그램에서 `url` 열을 QR 로 지정해 인쇄하면 됩니다.
URL 이 전부 대문자라 QR 이 영숫자 모드로 만들어져 칸 수가 줄어듭니다(짧은 도메인이면 25×25칸).

## 개발

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 태그 코드 체계 테스트
npm run typecheck
```

DB 규칙 테스트(로컬 Postgres 16):

```bash
createdb mimitest
psql -d mimitest -v ON_ERROR_STOP=1 \
  -f supabase/tests/00_supabase_stub.sql \
  -f supabase/migrations/20260927000001_init.sql \
  -f supabase/tests/01_rules.sql
```

## 보안 원칙

1. 공개 화면에 나가는 필드는 `src/lib/scan.ts` 한 곳에서만 고른다. DB 행을 통째로 내보내지 않는다.
2. 봉인·소유 이력 불변은 DB 트리거가 강제한다(앱 버그와 무관).
3. 운영자(관리자)도 편지·사진·연락처를 보지 않는다.
4. 가입 시 카카오 닉네임 외 개인정보를 받지 않는다.
5. 사진은 비공개 저장소에 두고, 10분짜리 서명 URL 로만 보여준다.

## 레떼즈 기존 태그

기존 `lettez.net/?sno=…` 코드는 새 태그의 `legacy_sno` 로 이관하고, lettez.net 을 이 앱에 연결하면 홈 화면이 새 태그 주소로 넘겨줍니다.
