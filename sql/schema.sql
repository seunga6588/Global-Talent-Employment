-- =========================================================
-- 2026학년도 글로벌 인재 취업 선도대학 학생 통합관리 시스템
-- Supabase SQL 스키마
-- =========================================================
-- 이 파일은 Supabase 대시보드 > SQL Editor 에서 실행합니다.
-- 순서대로 위에서부터 아래로 한 번에 실행하면 됩니다.
-- =========================================================

-- ---------------------------------------------------------
-- 0. 확장 기능 (UUID 자동 생성을 위해 필요)
-- ---------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- 1. admins : 관리자 권한을 가진 사용자 목록
--    Supabase Auth의 auth.users 테이블과 1:1로 연결됩니다.
--    이 테이블에 등록된 user_id 만 "관리자"로 취급합니다.
-- ---------------------------------------------------------
create table if not exists public.admins (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now(),
  unique(user_id)
);

-- 현재 로그인한 사용자가 관리자인지 확인하는 함수
-- (RLS 정책에서 재사용하기 위해 함수로 만듭니다)
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------
-- 2. students : 학생 기본정보
--    extra_fields(jsonb) 컬럼을 두어 엑셀에 새 항목이 생겨도
--    테이블 구조를 변경하지 않고 자유롭게 확장 가능하게 합니다.
-- ---------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default uuid_generate_v4(),
  student_no text not null unique,       -- 학번
  name text not null,                    -- 이름
  department text,                       -- 학과
  gender text,                           -- 성별
  nationality text,                      -- 국적
  phone text,                            -- 연락처
  kwork_id text,                         -- K-WORK 플랫폼 ID
  kwork_note text,                       -- K-WORK 관련 정보(민감하지 않은 메모)
  topik_level text,                      -- TOPIK 급수
  memo text,                             -- 비고
  extra_fields jsonb default '{}'::jsonb,-- 엑셀 추가 항목 등 확장 필드
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_students_student_no on public.students(student_no);
create index if not exists idx_students_name on public.students(name);

-- K-WORK 비밀번호 등 "민감정보"는 별도 보안 테이블로 분리합니다.
-- 이 테이블은 관리자만 접근 가능하도록 RLS 로 강하게 제한합니다.
create table if not exists public.student_secrets (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references public.students(id) on delete cascade,
  kwork_password_encrypted text, -- 원문이 아닌 암호화된 값만 저장 권장
  note text,
  updated_at timestamptz not null default now(),
  unique(student_id)
);

-- ---------------------------------------------------------
-- 3. programs : 교육 프로그램
-- ---------------------------------------------------------
create table if not exists public.programs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,                    -- 프로그램명
  category text,                         -- 교육구분
  edu_date date,                         -- 교육일자
  is_required boolean default true,      -- 필수/선택 여부
  required_hours numeric not null default 0, -- 인정 이수시간(필수시간)
  has_exam boolean default false,        -- 학습평가 실시 여부
  completion_criteria text,              -- 이수기준
  manager_name text,                     -- 담당자
  memo text,                             -- 비고
  retake_allowed boolean default false,  -- 재응시 허용 여부
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 4. enrollments : 학생별 프로그램 이수현황
--    students <-> programs 를 연결하는 중간 테이블입니다.
-- ---------------------------------------------------------
create table if not exists public.enrollments (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references public.students(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  attendance_status text default '결석', -- 참석 / 결석 / 일부참석
  completed_hours numeric not null default 0,   -- 이수시간
  status text not null default '미이수',         -- 이수 / 진행중 / 미이수 (자동계산)
  updated_at timestamptz not null default now(),
  unique(student_id, program_id)
);

create index if not exists idx_enrollments_student on public.enrollments(student_id);
create index if not exists idx_enrollments_program on public.enrollments(program_id);

-- 이수시간 입력/수정 시 이수여부(status)를 자동 계산하는 트리거
create or replace function public.calc_enrollment_status()
returns trigger
language plpgsql
as $$
declare
  req_hours numeric;
begin
  select required_hours into req_hours from public.programs where id = new.program_id;

  if new.completed_hours >= coalesce(req_hours, 0) and req_hours > 0 then
    new.status := '이수';
  elsif new.completed_hours > 0 then
    new.status := '진행중';
  else
    new.status := '미이수';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_calc_enrollment_status on public.enrollments;
create trigger trg_calc_enrollment_status
before insert or update of completed_hours on public.enrollments
for each row execute function public.calc_enrollment_status();

-- 새 프로그램이 추가되면 모든 학생에게 자동으로 enrollment 레코드를 만들어주는 트리거
create or replace function public.create_enrollments_for_new_program()
returns trigger
language plpgsql
as $$
begin
  insert into public.enrollments (student_id, program_id)
  select s.id, new.id from public.students s
  on conflict (student_id, program_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_new_program_enrollments on public.programs;
create trigger trg_new_program_enrollments
after insert on public.programs
for each row execute function public.create_enrollments_for_new_program();

-- 새 학생이 추가되면 기존 모든 프로그램에 대해 enrollment 레코드를 만들어주는 트리거
create or replace function public.create_enrollments_for_new_student()
returns trigger
language plpgsql
as $$
begin
  insert into public.enrollments (student_id, program_id)
  select new.id, p.id from public.programs p
  on conflict (student_id, program_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_new_student_enrollments on public.students;
create trigger trg_new_student_enrollments
after insert on public.students
for each row execute function public.create_enrollments_for_new_student();

-- ---------------------------------------------------------
-- 5. exams : 학습평가(시험) 기본정보
-- ---------------------------------------------------------
create table if not exists public.exams (
  id uuid primary key default uuid_generate_v4(),
  program_id uuid references public.programs(id) on delete set null,
  title text not null,                 -- 시험명
  question_count int not null default 0,
  is_started boolean default false,    -- 시험 시작 여부
  is_ended boolean default false,      -- 시험 종료 여부
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 6. exam_questions : 시험 문제 및 정답
--    ★ 정답(correct_index)은 학생에게 절대 노출되면 안 되므로
--      RLS 로 학생은 이 테이블을 직접 조회할 수 없게 막습니다.
--      (학생용 화면은 아래 view: exam_questions_public 을 사용)
-- ---------------------------------------------------------
create table if not exists public.exam_questions (
  id uuid primary key default uuid_generate_v4(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  seq int not null,                    -- 문제 순서
  question text not null,              -- 문제
  choices jsonb not null,              -- 보기 배열 ["보기1","보기2",...]
  correct_index int not null,          -- 정답 인덱스(0부터 시작) - 비공개
  score numeric not null default 10,   -- 문제별 배점
  created_at timestamptz not null default now()
);

create index if not exists idx_examq_exam on public.exam_questions(exam_id);

-- 학생에게는 정답이 빠진 버전만 노출하는 뷰
create or replace view public.exam_questions_public as
  select id, exam_id, seq, question, choices, score
  from public.exam_questions;

-- ---------------------------------------------------------
-- 7. exam_attempts : 학생별 시험 응시(결과) 정보
-- ---------------------------------------------------------
create table if not exists public.exam_attempts (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references public.students(id) on delete cascade,
  student_no text not null,
  exam_id uuid not null references public.exams(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  exam_title text,
  correct_count int not null default 0,
  total_count int not null default 0,
  score numeric not null default 0,
  submitted_at timestamptz not null default now()
);

create index if not exists idx_attempts_student on public.exam_attempts(student_id);
create index if not exists idx_attempts_exam on public.exam_attempts(exam_id);

-- ---------------------------------------------------------
-- 8. exam_answers : 학생이 제출한 문항별 답안
-- ---------------------------------------------------------
create table if not exists public.exam_answers (
  id uuid primary key default uuid_generate_v4(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.exam_questions(id) on delete cascade,
  selected_index int,
  is_correct boolean,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 9. Row Level Security 활성화
-- ---------------------------------------------------------
alter table public.students enable row level security;
alter table public.student_secrets enable row level security;
alter table public.programs enable row level security;
alter table public.enrollments enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;
alter table public.admins enable row level security;

-- admins: 관리자만 자기 자신 정보 조회 가능
create policy "admins_select_self" on public.admins
  for select using (public.is_admin());

-- students: 관리자만 전체 학생 목록 조회/수정 가능
-- (학생 본인 조회는 Supabase 클라이언트를 거치지 않고
--  Edge Function을 통해 "학번 존재 확인"만 제한적으로 제공합니다)
create policy "students_admin_all" on public.students
  for all using (public.is_admin()) with check (public.is_admin());

-- student_secrets: 관리자만 접근 가능 (일반 사용자는 절대 접근 불가)
create policy "student_secrets_admin_only" on public.student_secrets
  for all using (public.is_admin()) with check (public.is_admin());

-- programs: 관리자는 전체 CRUD, 학생(비로그인 포함)은 조회만 가능
--   (학생 시험화면에서 프로그램명을 보여주기 위해 최소한의 select 허용)
create policy "programs_admin_all" on public.programs
  for all using (public.is_admin()) with check (public.is_admin());
create policy "programs_public_select" on public.programs
  for select using (true);

-- enrollments: 관리자만 접근 (학생 개인 이수현황은 Edge Function으로 제공)
create policy "enrollments_admin_all" on public.enrollments
  for all using (public.is_admin()) with check (public.is_admin());

-- exams: 관리자는 전체 CRUD. 일반 사용자는 시작되었고 종료되지 않은 시험만 조회 가능
create policy "exams_admin_all" on public.exams
  for all using (public.is_admin()) with check (public.is_admin());
create policy "exams_public_select_active" on public.exams
  for select using (is_started = true and is_ended = false);

-- exam_questions: 정답이 포함되어 있으므로 관리자만 직접 접근 가능
-- (학생은 위에서 만든 exam_questions_public 뷰를 사용)
create policy "exam_questions_admin_all" on public.exam_questions
  for all using (public.is_admin()) with check (public.is_admin());

-- exam_attempts: 관리자는 전체 조회 가능.
--   일반 사용자의 응시 결과 저장/조회는 Edge Function(서비스 키)을 통해서만 수행하여
--   "다른 학생의 시험 결과"가 절대 노출되지 않도록 합니다.
create policy "exam_attempts_admin_all" on public.exam_attempts
  for all using (public.is_admin()) with check (public.is_admin());

-- exam_answers: 관리자만 접근
create policy "exam_answers_admin_all" on public.exam_answers
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------
-- 10. exam_questions_public 뷰에 대한 접근 권한
--    (뷰 자체는 RLS 대상이 아니지만, 기반 테이블 RLS 때문에
--     일반 사용자가 select 시 0건이 반환됩니다.
--     따라서 이 뷰도 Edge Function을 통해 제공하는 것을 권장합니다.)
-- ---------------------------------------------------------
-- 참고: 보안을 가장 강하게 하려면 학생용 문제조회/제출/채점을 모두
-- Supabase Edge Function(서비스 역할 키 사용, RLS 우회)으로 처리하세요.
-- 이 프로젝트에는 supabase/functions/grade-exam 예시가 포함되어 있습니다.

-- ---------------------------------------------------------
-- 11. 완료
-- ---------------------------------------------------------
-- 이후 "관리자 계정 생성"은 README.md 의 절차를 따라
-- Supabase Auth 에서 사용자를 만든 뒤, admins 테이블에
-- 해당 user_id 를 등록하면 됩니다.
