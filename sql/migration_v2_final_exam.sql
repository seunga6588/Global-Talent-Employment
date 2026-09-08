-- =========================================================
-- 마이그레이션 v2
-- - 학습평가를 "프로그램별"이 아니라 "전체 프로그램 종료 후 1회"로 변경
-- - exams 테이블에 재응시 허용 여부를 직접 저장 (더 이상 programs 테이블 경유 X)
-- -----------------------------------------------------------
-- Supabase SQL Editor에서 이 파일 내용만 실행하면 됩니다.
-- (기존 schema.sql을 다시 실행할 필요 없음 — 이미 실행되어 있으므로)
-- =========================================================

-- exams 테이블에 재응시 허용 여부 컬럼 추가
alter table public.exams
  add column if not exists retake_allowed boolean not null default false;

-- exams.program_id는 더 이상 필수가 아님 (이제 특정 프로그램에 종속되지 않는
-- "전체 과정 종합 학습평가" 이므로). 기존 컬럼은 그대로 두되 사용하지 않습니다.
alter table public.exams
  alter column program_id drop not null;

-- 완료 처리를 위해 확인:
select 'migration v2 완료' as status;
