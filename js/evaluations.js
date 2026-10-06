// =========================================================
// admin/evaluations.html 전용 스크립트
// -----------------------------------------------------------
// 학부과장(admins.department 값이 있는 계정)은 자기 학과 학생만 보이고,
// 전체 관리자(department가 비어있는 계정)는 학과 필터로 전체를 볼 수 있습니다.
//
// 예산은 "학과 묶음"(department_groups)을 반영해서, 서로 다른 학과명이지만
// 같은 묶음으로 지정된 경우 하나의 예산을 함께 사용합니다.
// =========================================================

let myDepartment = null;      // 로그인한 계정의 담당 학과 (null이면 전체 관리자)
let evalStudentsCache = [];   // 화면용 가공 데이터
let currentEvalStudentId = null;
let departmentGroupMap = {};  // { 학과명: 묶음이름 }
let budgetByGroupKey = {};    // { 정원관리키(묶음 또는 학과명): 총 예산 }
let usedByGroupKey = {};      // { 정원관리키: 현재까지 등급으로 배정된 금액 }

// 우수학생 평가 "대상자" 조건 (둘 중 하나만 만족해도 대상에 포함됩니다)
// 1) 총 이수시간 120시간 이상 + 학습평가 통과(기준 점수 이상)
// 2) 취업 또는 취업예정 상태인 학생
// 학습평가 통과 기준 점수는 필요 시 아래 숫자만 바꾸면 됩니다.
const EVAL_TARGET_MIN_HOURS = 120;
const EVAL_TARGET_PASS_SCORE = 80;
const EVAL_TARGET_EMPLOYMENT_STATUSES = ["취업", "취업예정"];

function isEvalTarget(student) {
  const hoursAndExamOk = student.completedHours >= EVAL_TARGET_MIN_HOURS && student.bestExamScore !== null && student.bestExamScore >= EVAL_TARGET_PASS_SCORE;
  const employmentOk = EVAL_TARGET_EMPLOYMENT_STATUSES.includes(student.employment_status);
  return hoursAndExamOk || employmentOk;
}

const EVAL_FIELDS = [
  "score_participation",
  "score_understanding",
  "score_major_skill",
  "score_korean",
  "score_job_prep",
  "score_field_adapt",
  "score_employment",
  "score_growth",
];

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("evaluations", auth.admin.name, auth.admin.department);
  myDepartment = auth.admin.department || null;

  await loadEvalData();

  document.getElementById("saveEvalBtn").addEventListener("click", saveEvaluation);
  document.querySelectorAll(".eval-score").forEach((input) => {
    input.addEventListener("input", () => {
      // 배점을 넘는 값은 입력 즉시 최대값으로 보정
      const max = Number(input.dataset.max);
      if (Number(input.value) > max) input.value = max;
      if (Number(input.value) < 0) input.value = 0;
      updateEvalTotalPreview();
    });
  });
})();

function formatWon(n) {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
}

async function loadEvalData() {
  const [{ data: students }, { data: enrollments }, { data: programs }, { data: attempts }, { data: evaluations }, { data: groups }, { data: quotas }] = await Promise.all([
    fetchAllRows("students", "id, student_no, name, department, topik_level, employment_status"),
    fetchAllRows("enrollments", "student_id, program_id, completed_hours, status"),
    fetchAllRows("programs", "id, required_hours, equivalent_group"),
    fetchAllRows("exam_attempts", "student_id, score"),
    fetchAllRows("student_evaluations", "*"),
    fetchAllRows("department_groups", "*", null, "department"),
    fetchAllRows("department_quotas", "*", null, "department"),
  ]);

  departmentGroupMap = {};
  (groups || []).forEach((g) => (departmentGroupMap[g.department] = g.group_name));

  budgetByGroupKey = {};
  (quotas || []).forEach((q) => (budgetByGroupKey[q.department] = Number(q.budget_amount || 0)));

  usedByGroupKey = {};
  (evaluations || []).forEach((ev) => {
    if (!ev.grade) return;
    const s = (students || []).find((x) => x.id === ev.student_id);
    if (!s?.department) return;
    const key = resolveQuotaGroupKey(s.department, departmentGroupMap);
    usedByGroupKey[key] = (usedByGroupKey[key] || 0) + (GRADE_AMOUNTS[ev.grade] || 0);
  });

  const scopedStudents = myDepartment
    ? (students || []).filter((s) => resolveQuotaGroupKey(s.department, departmentGroupMap) === myDepartment)
    : students || [];

  // 전체 관리자용 학과 필터 드롭다운 렌더링
  if (!myDepartment) {
    const depts = Array.from(new Set((students || []).map((s) => s.department).filter(Boolean))).sort();
    const area = document.getElementById("deptFilterArea");
    area.innerHTML = `<select id="deptFilterSelect" class="form-select form-select-sm">
      <option value="">전체 학과</option>
      ${depts.map((d) => `<option value="${d}">${d}</option>`).join("")}
    </select>`;
    document.getElementById("deptFilterSelect").addEventListener("change", renderEvalTable);
  }

  evalStudentsCache = scopedStudents
    .map((s) => {
      const rows = (enrollments || []).filter((e) => e.student_id === s.id);
      const { totalCompleted } = computeGroupedCompletion(programs, rows);
      const examRows = (attempts || []).filter((a) => a.student_id === s.id);
      const avgScore = examRows.length ? Math.round((examRows.reduce((sum, a) => sum + Number(a.score), 0) / examRows.length) * 10) / 10 : null;
      const bestExamScore = examRows.length ? Math.max(...examRows.map((a) => Number(a.score))) : null;
      const evaluation = (evaluations || []).find((ev) => ev.student_id === s.id) || null;

      return { ...s, completedHours: totalCompleted, avgScore, bestExamScore, evaluation };
    })
    // 평가 대상 조건(총 이수시간 120시간+학습평가 통과, 또는 취업/취업예정)을 만족하는 학생만 남깁니다.
    .filter(isEvalTarget);

  renderEvalTable();
}

function renderEvalTable() {
  const q = (document.getElementById("evalSearch").value || "").toLowerCase();
  const deptSelect = document.getElementById("deptFilterSelect");
  const deptFilter = deptSelect ? deptSelect.value : "";

  const list = evalStudentsCache.filter((s) => {
    if (deptFilter && s.department !== deptFilter) return false;
    if (q && !(s.name?.toLowerCase().includes(q) || s.student_no?.toLowerCase().includes(q))) return false;
    return true;
  });

  const tbody = document.getElementById("evalBody");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">평가할 학생이 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((s) => {
      const ev = s.evaluation;
      const gradeText = ev?.grade ? `${ev.grade}등급` : "미평가";
      const gradeClass = ev?.grade ? `badge-grade-${ev.grade}` : "badge-grade-none";
      return `<tr>
        <td>${s.student_no}</td>
        <td>${s.name}</td>
        <td>${s.department ?? "-"}</td>
        <td class="text-end">${s.completedHours}시간</td>
        <td>${s.employment_status ?? "-"}</td>
        <td class="text-end">${s.bestExamScore ?? "-"}</td>
        <td class="text-end">${ev ? ev.total_score + "점" : "-"}</td>
        <td><span class="badge-status ${gradeClass}">${gradeText}</span></td>
        <td><button class="btn btn-outline-navy btn-sm" onclick="openEvalModal('${s.id}')">평가하기</button></td>
      </tr>`;
    })
    .join("");
}

function openEvalModal(studentId) {
  const s = evalStudentsCache.find((x) => x.id === studentId);
  if (!s) return;
  currentEvalStudentId = studentId;

  document.getElementById("evalModalTitle").textContent = `${s.name} (${s.student_no}) 평가`;
  document.getElementById("evalInfoHours").textContent = `${s.completedHours}시간`;
  document.getElementById("evalInfoEmployment").textContent = s.employment_status ?? "미입력";
  document.getElementById("evalInfoExam").textContent = s.bestExamScore !== null ? `${s.bestExamScore}점 (최고점)` : "미응시";
  document.getElementById("evalInfoTopik").textContent = s.topik_level ?? "-";

  const groupKey = resolveQuotaGroupKey(s.department, departmentGroupMap);
  const budget = budgetByGroupKey[groupKey] || 0;
  const used = usedByGroupKey[groupKey] || 0;
  const quotaInfo = document.getElementById("evalQuotaInfo");
  if (quotaInfo) {
    quotaInfo.textContent =
      budget > 0
        ? `${groupKey} 예산 현황: ${formatWon(used)} 사용 / 총 ${formatWon(budget)} (잔여 ${formatWon(budget - used)})`
        : `${groupKey} 예산이 아직 설정되지 않았습니다. ("학과별 인원 설정"에서 설정해주세요)`;
  }

  const form = document.getElementById("evalForm");
  form.reset();
  form.elements["student_id"].value = studentId;

  const ev = s.evaluation;
  EVAL_FIELDS.forEach((f) => {
    form.elements[f].value = ev ? ev[f] ?? 0 : 0;
  });
  form.elements["comment"].value = ev?.comment ?? "";

  updateEvalTotalPreview();
  new bootstrap.Modal(document.getElementById("evalModal")).show();
}

function computeTotalAndGrade() {
  const form = document.getElementById("evalForm");
  let total = 0;
  EVAL_FIELDS.forEach((f) => {
    total += Number(form.elements[f].value || 0);
  });
  return { total, grade: gradeFromScore(total) };
}

function updateEvalTotalPreview() {
  const { total, grade } = computeTotalAndGrade();
  document.getElementById("evalTotalScore").textContent = total;

  const badge = document.getElementById("evalGradeBadge");
  const gradeText = { S: `S등급 (장려금 ${formatWon(GRADE_AMOUNTS.S)})`, A: `A등급 (장려금 ${formatWon(GRADE_AMOUNTS.A)})`, B: `B등급 (장려금 ${formatWon(GRADE_AMOUNTS.B)})` };
  badge.textContent = grade ? gradeText[grade] : "기준 미달";
  badge.className = "badge-status " + (grade ? `badge-grade-${grade}` : "badge-grade-none");
}

async function saveEvaluation() {
  const form = document.getElementById("evalForm");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  EVAL_FIELDS.forEach((f) => (payload[f] = Number(payload[f] || 0)));
  const { total, grade } = computeTotalAndGrade();
  payload.total_score = total;
  payload.grade = grade;

  // ---------------------------------------------------------
  // 학과(묶음) 예산 초과 여부 확인
  // ---------------------------------------------------------
  const student = evalStudentsCache.find((x) => x.id === currentEvalStudentId);
  const groupKey = resolveQuotaGroupKey(student?.department, departmentGroupMap);
  const budget = budgetByGroupKey[groupKey] || 0;

  if (budget > 0) {
    const previousGrade = student.evaluation?.grade || null;
    const currentUsed = usedByGroupKey[groupKey] || 0;
    const previousAmount = previousGrade ? GRADE_AMOUNTS[previousGrade] || 0 : 0;
    const newAmount = grade ? GRADE_AMOUNTS[grade] || 0 : 0;
    const projectedUsed = currentUsed - previousAmount + newAmount;

    if (grade && projectedUsed > budget) {
      alert(
        `⚠️ ${groupKey}의 우수학생 장려금 예산(${formatWon(budget)})을 초과합니다.\n` +
        `현재 사용액: ${formatWon(currentUsed)} / 이 학생에게 필요한 금액: ${formatWon(newAmount)}\n\n` +
        `등급을 부여하려면 먼저 "학과별 인원 설정"에서 예산을 늘리거나,\n` +
        `다른 학생의 등급을 조정해주세요.`
      );
      return;
    }
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  payload.evaluator_user_id = session.user.id;

  const { error } = await supabaseClient.from("student_evaluations").upsert(payload, { onConflict: "student_id" });
  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }

  bootstrap.Modal.getInstance(document.getElementById("evalModal")).hide();
  await loadEvalData();
}
