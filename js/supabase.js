// =========================================================
// Supabase 클라이언트 초기화
// -----------------------------------------------------------
// ⚠️ 아래 SUPABASE_URL 과 SUPABASE_ANON_KEY 는
//    Supabase 대시보드 > Project Settings > API 에서 확인 후
//    반드시 본인 프로젝트 값으로 교체해야 합니다.
// -----------------------------------------------------------
// anon key는 "공개해도 되는 키"입니다. (RLS로 보호되기 때문)
// 절대 service_role key를 이 파일에 넣지 마세요!
// =========================================================

const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY";

// Supabase JS 라이브러리(CDN)로부터 클라이언트를 생성합니다.
// 각 HTML 파일에서 아래 스크립트를 supabase.js 보다 먼저 불러와야 합니다:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Edge Function 호출 시 사용할 기본 URL
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// 학생용 화면(비로그인)에서 Edge Function을 호출할 때 사용하는 헬퍼 함수
async function callEdgeFunction(name, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}
