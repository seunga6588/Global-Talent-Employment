// =========================================================
// admin/dept-quota.html 전용 스크립트
// - 학과 묶음(department_groups) 설정
// - 학과(묶음)별 우수학생 장려금 총 예산(department_quotas.budget_amount) 설정
// "전체 관리자"만 접근하는 페이지입니다.
// =========================================================

let allDepartments = [];
let departmentGroupMap = {}; // { 학과명: 묶음이름 }

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;

  if (auth.admin.department) {
    alert("학과별 예산 설정은 전체 관리자만 접근할 수 있습니다.");
    window.location.href = "dashboard.html";
    return;
  }

  renderLayout("dept-quota", auth.admin.name, auth.admin.department);
  await loadAll();
})();

function formatWon(n) {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
}

async function loadAll() {
  const [{ data: students }, { data: groups }, { data: evaluations }, { data: quotas }] = await Promise.all([
    fetchAllRows("students", "department"),
    fetchAllRows("department_groups", "*"),
    fetchAllRows("student_evaluations", "grade, students(department)"),
    fetchAllRows("department_quotas", "*"),
  ]);

  allDepartments = Array.from(new Set((students || []).map((s) => s.department).filter(Boolean))).sort();
  departmentGroupMap = {};
  (groups || []).forEach((g) => (departmentGroupMap[g.department] = g.group_name));

  renderGroupTable();
  renderBudgetTable(evaluations || [], quotas || []);
}

// ---------------------------------------------------------
// 학과 묶음 설정
// ---------------------------------------------------------
function renderGroupTable() {
  const tbody = document.getElementById("groupBody");
  if (!allDepartments.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">등록된 학과가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = allDepartments
    .map(
      (d) => `<tr>
        <td>${d}</td>
        <td><input type="text" class="form-control form-control-sm group-input" data-dept="${d}" placeholder="묶음 이름 (선택)" value="${departmentGroupMap[d] ?? ""}"></td>
        <td><button class="btn btn-outline-navy btn-sm" onclick="saveGroup('${d}')">저장</button></td>
      </tr>`
    )
    .join("");
}

async function saveGroup(department) {
  const input = document.querySelector(`.group-input[data-dept="${department}"]`);
  const groupName = input.value.trim();

  let error;
  if (groupName) {
    ({ error } = await supabaseClient.from("department_groups").upsert({ department, group_name: groupName }, { onConflict: "department" }));
  } else {
    // 빈 값으로 저장하면 묶음 해제 (해당 학과 단독 관리로 되돌림)
    ({ error } = await supabaseClient.from("department_groups").delete().eq("department", department));
  }

  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }
  await loadAll();
}

// ---------------------------------------------------------
// 예산 설정
// ---------------------------------------------------------
function renderBudgetTable(evaluations, quotas) {
  // 학과 -> 정원 관리 키(묶음 또는 자기 자신)로 매핑, 키 -> 소속 학과 목록
  const keyToDepts = {};
  allDepartments.forEach((d) => {
    const key = resolveQuotaGroupKey(d, departmentGroupMap);
    keyToDepts[key] = keyToDepts[key] || [];
    keyToDepts[key].push(d);
  });

  // 키별 현재 배정 금액 합산
  const usedByKey = {};
  evaluations.forEach((ev) => {
    if (!ev.grade) return;
    const dept = ev.students?.department;
    if (!dept) return;
    const key = resolveQuotaGroupKey(dept, departmentGroupMap);
    usedByKey[key] = (usedByKey[key] || 0) + (GRADE_AMOUNTS[ev.grade] || 0);
  });

  const budgetByKey = {};
  quotas.forEach((q) => (budgetByKey[q.department] = Number(q.budget_amount || 0)));

  const keys = Object.keys(keyToDepts).sort();
  const tbody = document.getElementById("budgetBody");
  if (!keys.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">등록된 학과가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = keys
    .map((key) => {
      const used = usedByKey[key] || 0;
      const budget = budgetByKey[key] || 0;
      const remaining = budget - used;
      const over = budget > 0 && remaining < 0;
      return `<tr>
        <td style="font-weight:700;">${key}</td>
        <td style="font-size:12.5px; color:var(--text-sub);">${keyToDepts[key].join(", ")}</td>
        <td class="text-end">${formatWon(used)}</td>
        <td><input type="number" min="0" step="10000" class="form-control form-control-sm budget-input" data-key="${key}" value="${budget}"></td>
        <td class="text-end" style="font-weight:700; ${over ? "color:var(--danger);" : ""}">${formatWon(remaining)}</td>
        <td><button class="btn btn-outline-navy btn-sm" onclick="saveBudget('${key}')">저장</button></td>
      </tr>`;
    })
    .join("");
}

async function saveBudget(key) {
  const input = document.querySelector(`.budget-input[data-key="${key}"]`);
  const budget_amount = Number(input.value || 0);

  const { error } = await supabaseClient.from("department_quotas").upsert({ department: key, budget_amount }, { onConflict: "department" });
  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }
  await loadAll();
}
