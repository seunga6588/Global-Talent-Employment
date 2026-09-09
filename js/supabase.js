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

const SUPABASE_URL = "https://znqdcihducwsypxzmmvb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucWRjaWhkdWN3c3lweHptbXZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Nzk1NzUsImV4cCI6MjEwNDI1NTU3NX0.73JYccO9T0RU80bbWDpIZlg6ozNaspJrM9L2y5q3X9A";

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

// -----------------------------------------------------------
// Supabase는 한 번에 최대 1000건까지만 데이터를 돌려줍니다.
// 학생 수 x 프로그램 수가 많아지면 enrollments 같은 테이블은
// 1000건을 쉽게 넘기 때문에, 여러 번 나눠서(페이지네이션) 전체를
// 끝까지 가져오는 헬퍼 함수입니다. 대시보드/학생목록 등 "전체 조회"가
// 필요한 곳에서는 supabaseClient.from(...) 대신 이 함수를 사용하세요.
// -----------------------------------------------------------
async function fetchAllRows(tableName, selectStr, filterFn) {
  const pageSize = 1000;
  let from = 0;
  let allRows = [];

  while (true) {
    // range 페이지네이션은 정렬 기준이 없으면 페이지 간 순서가 흔들려 데이터가
    // 누락되거나 중복될 수 있으므로, 항상 id 기준으로 정렬해서 안정적으로 가져옵니다.
    let query = supabaseClient.from(tableName).select(selectStr).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (filterFn) query = filterFn(query);
    const { data, error } = await query;
    if (error) return { data: null, error };

    allRows = allRows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return { data: allRows, error: null };
}
