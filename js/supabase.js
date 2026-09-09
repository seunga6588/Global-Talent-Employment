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

// -----------------------------------------------------------
// "동일과목 그룹" 반영 이수현황 계산 헬퍼
// -----------------------------------------------------------
// 같은 equivalent_group 값을 가진 프로그램들(예: 공통교과/비교과/글산과 버전)은
// 사실상 같은 과목이므로, 한 학생 기준으로 "패스가 아닌" 트랙 중
// 이수여부/이수시간이 가장 우선순위 높은 트랙 하나만 그 과목의 대표 기록으로 인정합니다.
//
// ★ 총 필요시간(분모)은 전체 프로그램 구성 기준으로 항상 고정됩니다
//   (예: 200시간). 그룹 내 모든 트랙이 "패스"인 과목이라도 필요시간에서
//   빼지 않고, 대신 그 과목은 "이미 충족된 것"으로 보고 필요시간만큼
//   그대로 이수시간에 인정합니다. 그래야 학생마다 총 시간이 달라지지 않습니다.
//
// programs: [{ id, required_hours, equivalent_group }, ...] 전체 프로그램 목록
// studentEnrollments: 해당 학생의 enrollments 배열 [{ program_id, completed_hours, status }, ...]
//
// 반환값: { totalRequired, totalCompleted, overallStatus }
// -----------------------------------------------------------
function computeGroupedCompletion(programs, studentEnrollments) {
  const groups = {}; // key -> { requiredHours, programIds: [] }

  (programs || []).forEach((p) => {
    const key = p.equivalent_group || `__solo_${p.id}`;
    if (!groups[key]) groups[key] = { requiredHours: 0, programIds: [] };
    groups[key].requiredHours = Math.max(groups[key].requiredHours, Number(p.required_hours || 0));
    groups[key].programIds.push(p.id);
  });

  const statusPriority = { "이수": 3, "진행중": 2, "미이수": 1 };

  let totalRequired = 0;
  let totalCompleted = 0;
  let allGroupsDone = true;
  let anyProgress = false;

  Object.values(groups).forEach((g) => {
    // 총 필요시간은 학생과 무관하게 항상 전체 그룹 기준으로 고정 합산합니다.
    totalRequired += g.requiredHours;

    const rowsInGroup = (studentEnrollments || []).filter((e) => g.programIds.includes(e.program_id));
    const nonPassRows = rowsInGroup.filter((r) => r.status !== "패스");

    if (nonPassRows.length > 0) {
      // 패스가 아닌 트랙들 중 이수여부 우선순위(이수>진행중>미이수)가 높고,
      // 같은 우선순위면 이수시간이 큰 트랙을 대표 기록으로 사용
      const rep = nonPassRows.reduce((best, r) => {
        const bp = statusPriority[best.status] || 0;
        const rp = statusPriority[r.status] || 0;
        if (rp > bp) return r;
        if (rp === bp && Number(r.completed_hours || 0) > Number(best.completed_hours || 0)) return r;
        return best;
      }, nonPassRows[0]);

      totalCompleted += Number(rep.completed_hours || 0);
      if (rep.status !== "이수") allGroupsDone = false;
      if (Number(rep.completed_hours || 0) > 0 || rep.status === "진행중") anyProgress = true;
    } else if (rowsInGroup.length > 0) {
      // 그룹 내 모든 트랙이 "패스" -> 이 학생에게는 해당 과목이 적용되지 않으므로
      // 이미 충족된 것으로 보고 필요시간만큼 그대로 이수시간에 인정합니다.
      totalCompleted += g.requiredHours;
      anyProgress = true;
    } else {
      // 이수현황 레코드 자체가 없음 -> 미이수로 처리 (필요시간에는 포함, 이수시간은 0)
      allGroupsDone = false;
    }
  });

  const overallStatus = totalRequired === 0 ? "미이수" : allGroupsDone ? "이수" : anyProgress ? "진행중" : "미이수";

  return { totalRequired, totalCompleted, overallStatus };
}
