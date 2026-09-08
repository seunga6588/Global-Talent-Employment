# 2026 글로벌 인재 취업 선도대학 학생 통합관리 시스템

Supabase(DB/인증/서버함수) + GitHub Pages(프론트엔드 배포)로 동작하는
학생 교육이수·학습평가 통합관리 웹앱입니다.

이 문서는 **처음 해보시는 분도 그대로 따라 하면 배포까지 완료**할 수 있도록
순서대로 설명합니다.

---

## 0. 준비물

- GitHub 계정
- Supabase 계정 (https://supabase.com 에서 무료 가입)
- (선택) Supabase CLI - Edge Function 배포 시 필요

---

## 1. GitHub Repository 생성

1. GitHub에 로그인 → 우측 상단 `+` → `New repository`
2. Repository 이름 입력 (예: `global-talent-lms`)
3. `Public` 선택 (GitHub Pages 무료 사용을 위해)
4. `Create repository` 클릭
5. 이 프로젝트 폴더의 모든 파일(`index.html`, `login.html`, `admin/`, `student/`, `css/`, `js/`, `sql/`, `supabase/`, `README.md`)을 그대로 업로드합니다.
   - 웹 브라우저에서 `Add file → Upload files` 로 드래그 앤 드롭 해도 되고,
   - git 명령어를 아는 경우 아래처럼 진행해도 됩니다.

```bash
git init
git remote add origin https://github.com/내계정/global-talent-lms.git
git add .
git commit -m "초기 커밋"
git branch -M main
git push -u origin main
```

---

## 2. Supabase 프로젝트 생성

1. https://supabase.com 접속 → 로그인 → `New Project`
2. Organization 선택 후 프로젝트 이름/비밀번호/리전(가까운 지역, 예: Northeast Asia (Seoul) 있으면 선택) 입력
3. `Create new project` 클릭 (1~2분 정도 초기화 시간이 걸립니다)

---

## 3. SQL 실행 (테이블 생성)

1. Supabase 프로젝트 대시보드 좌측 메뉴에서 `SQL Editor` 클릭
2. `New query` 클릭
3. 이 프로젝트의 `sql/schema.sql` 파일 내용을 전체 복사하여 붙여넣기
4. 우측 하단 `Run` 클릭
5. 에러 없이 완료되면 좌측 `Table Editor` 메뉴에서 `students`, `programs`, `enrollments`, `exams`, `exam_questions`, `exam_attempts`, `exam_answers`, `admins`, `student_secrets` 테이블이 생성된 것을 확인합니다.

---

## 4. Supabase URL 및 anon key 설정

1. Supabase 대시보드 → 좌측 하단 톱니바퀴(`Project Settings`) → `API`
2. `Project URL` 과 `anon public` 키를 복사합니다.
3. 이 프로젝트의 `js/supabase.js` 파일을 열어 아래 두 줄을 본인 값으로 수정합니다.

```js
const SUPABASE_URL = "https://내프로젝트ref.supabase.co";
const SUPABASE_ANON_KEY = "내 anon public 키";
```

4. 수정한 파일을 GitHub Repository에 다시 업로드(커밋)합니다.

> ⚠️ `anon key`는 공개되어도 되는 키입니다(테이블마다 RLS 정책으로 보호됩니다).
> 반드시 `service_role` 키는 이 파일이나 어떤 프론트엔드 코드에도 절대 넣지 마세요.

---

## 5. Edge Function 배포 (학생용 보안 기능)

학생이 학번을 조회하거나 시험을 응시/채점할 때는 `student_secrets`, 정답 등
민감한 데이터에 접근해야 하므로, RLS를 우회할 수 있는 **Edge Function**(서버 코드)을
사용합니다. `service_role` 키는 이 Edge Function 내부(Supabase 서버)에서만 사용되고
학생 브라우저에는 절대 전달되지 않습니다.

### 5-1. Supabase CLI 설치 및 로그인

```bash
npm install -g supabase
supabase login
```

### 5-2. 프로젝트 연결 및 배포

```bash
# 프로젝트 폴더 최상단(README.md가 있는 위치)에서 실행
supabase link --project-ref 내프로젝트ref

supabase functions deploy lookup-student
supabase functions deploy get-exam
supabase functions deploy submit-exam
```

### 5-3. 환경변수 확인

Edge Function은 자동으로 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 환경변수를
Supabase가 제공하므로 별도 설정이 필요 없습니다.

> Supabase CLI 설치가 어려운 경우, Supabase 대시보드 좌측 메뉴의
> `Edge Functions → Create a new function` 화면에서 각 함수 이름
> (`lookup-student`, `get-exam`, `submit-exam`)을 만들고
> `supabase/functions/해당폴더/index.ts` 내용을 그대로 붙여넣어 배포할 수도 있습니다.

---

## 6. 관리자 계정 생성

1. Supabase 대시보드 → `Authentication` → `Users` → `Add user`
2. 이메일/비밀번호 입력 후 생성 (예: admin@seojeong.ac.kr)
3. 생성된 사용자의 `UID` 값을 복사합니다 (Users 목록에서 확인 가능)
4. `SQL Editor` 에서 아래 쿼리를 실행하여 이 사용자를 관리자로 등록합니다.

```sql
insert into public.admins (user_id, name)
values ('복사한-UID-값', '관리자 이름');
```

5. 이제 사이트의 `login.html` 에서 이 이메일/비밀번호로 로그인하면 관리자 화면에 접속할 수 있습니다.

---

## 7. 교육 프로그램 등록

1. 관리자 로그인 후 `교육관리` 메뉴 이동
2. `+ 프로그램 추가` 클릭 → 프로그램명, 필수 이수시간, 학습평가 실시 여부 등 입력 후 저장
3. 프로그램을 추가하면 기존에 등록된 모든 학생에게 자동으로 이수현황(0시간, 미이수)이 생성됩니다.

---

## 8. 학생 Excel/CSV 업로드

1. 관리자 로그인 후 `학생관리` 메뉴 이동
2. 엑셀 파일의 첫 번째 행(헤더)에 아래와 같은 한글 컬럼명을 사용합니다.

   `학번 | 이름 | 학과 | 성별 | 국적 | 연락처 | K-WORK 플랫폼 ID | K-WORK 관련 정보 | TOPIK 급수 | 비고`

   - 위 목록에 없는 새로운 컬럼을 추가해도 괜찮습니다. 자동으로 "추가 정보"로 저장됩니다.
   - `학번` 컬럼은 반드시 있어야 합니다.

3. `엑셀 일괄등록` 옆의 파일 선택 버튼으로 엑셀 파일을 고른 뒤 `엑셀 일괄등록` 버튼 클릭
4. 이미 등록된 학번이면 정보가 갱신되고, 새로운 학번이면 새로 등록됩니다.

---

## 9. GitHub Pages 활성화

1. GitHub Repository 페이지 → `Settings` → 좌측 메뉴 `Pages`
2. `Build and deployment` → `Source` 를 `Deploy from a branch` 로 설정
3. `Branch` 를 `main` / `/ (root)` 로 선택 후 `Save`
4. 1~2분 후 상단에 `https://내계정.github.io/repository이름/` 형태의 주소가 표시됩니다.

---

## 10. 사이트 접속 및 테스트

1. GitHub Pages로 생성된 주소로 접속 (예: `https://내계정.github.io/global-talent-lms/`)
2. `관리자 로그인` 클릭 → 6번에서 만든 계정으로 로그인 → Dashboard 확인
3. `학생관리 → 학생 추가` 또는 엑셀 업로드로 테스트 학생 등록
4. `교육관리` 에서 학습평가 실시 여부를 `실시`로 설정한 프로그램 추가
5. `학습평가 → 시험 관리` 에서 해당 프로그램에 연결된 시험 생성 → 문제 추가 → `시험 시작` 클릭
6. 새 브라우저 탭에서 `.../student/exam.html` 접속 → 테스트 학생의 학번 입력 → 시험 응시 → 제출
7. 관리자 화면의 `학습평가 → 시험 결과` 및 `학생 상세페이지`에서 점수가 정상적으로 연동되는지 확인

---

## 폴더 구조

```
/
├── index.html              # 첫 진입 화면(관리자/학생 선택)
├── login.html               # 관리자 로그인
├── student/
│   └── exam.html             # 학생 학습평가 응시 화면
├── admin/
│   ├── dashboard.html
│   ├── students.html
│   ├── student-detail.html
│   ├── programs.html
│   ├── exams.html
│   └── results.html
├── css/
│   └── style.css
├── js/
│   ├── supabase.js           # Supabase 클라이언트 초기화 (URL/KEY 설정)
│   ├── auth.js                # 로그인/로그아웃/관리자 권한 체크
│   ├── layout.js               # 공통 헤더/사이드바
│   ├── dashboard.js
│   ├── students.js
│   ├── student-detail.js
│   ├── programs.js
│   ├── exams.js
│   ├── results.js
│   └── student-exam.js
├── sql/
│   └── schema.sql             # Supabase 테이블/RLS 생성 스크립트
├── supabase/
│   └── functions/
│       ├── lookup-student/    # 학번 확인(이름 마스킹 반환)
│       ├── get-exam/          # 정답 제외 문제 제공, 중복응시 확인
│       └── submit-exam/       # 서버 측 자동채점 및 저장
└── README.md
```

---

## 보안 설계 요약

- 학생 개인정보/시험 정답/응시 결과는 GitHub Repository의 정적 파일에 저장되지 않고
  전부 Supabase DB에 저장됩니다.
- `students`, `enrollments`, `exam_attempts`, `exam_questions`(정답 포함) 등은
  Supabase RLS로 **관리자 계정(admins 테이블에 등록된 사용자)만** 접근 가능합니다.
- 학생은 로그인 없이 이용하므로, 학번 확인·문제 조회(정답 제외)·답안 제출/채점은
  전부 **Edge Function(서버 코드)** 을 통해서만 처리됩니다. 이 서버 코드 안에서만
  `service_role` 키를 사용하므로 학생 브라우저에는 절대 노출되지 않습니다.
- K-WORK 비밀번호 등 특히 민감한 정보는 `student_secrets` 라는 별도 테이블에 분리하여
  관리자만 접근 가능하도록 설계했습니다. 실제 운영 시에는 이 테이블에 평문이 아닌
  암호화된 값만 저장하는 것을 권장합니다.

---

## 자주 발생하는 문제

| 증상 | 원인 / 해결 |
|---|---|
| 로그인이 안 됨 | `js/supabase.js` 의 URL/KEY 값을 확인하세요. `admins` 테이블에 해당 계정이 등록되어 있는지도 확인하세요. |
| 학생 목록이 안 보임 | 관리자 계정으로 로그인했는지 확인. RLS 정책상 비로그인/일반 계정은 조회되지 않습니다. |
| 학번 조회가 안 됨(학생화면) | Edge Function(`lookup-student`)이 정상 배포되었는지 Supabase 대시보드의 `Edge Functions` 메뉴에서 확인하세요. |
| 엑셀 업로드가 안 됨 | 엑셀 헤더에 `학번` 컬럼이 정확히 있는지 확인하세요. |
