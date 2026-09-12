// =========================================================
// admin/evaluations.html 전용 스크립트
// -----------------------------------------------------------
// 학부과장(admins.department 값이 있는 계정)은 자기 학과 학생만 보이고,
// 전체 관리자(department가 비어있는 계정)는 학과 필터로 전체를 볼 수 있습니다.
// =========================================================

let myDepartment = null;      // 로그인한 계정의 담당 학과 (null이면 전체 관리자)
let evalStudentsCache = [];   // 화면용 가공 데이터
let currentEvalStudentId = null;

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
  renderLayout("evaluations", auth.admin.name);
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

async function loadEvalData() {
  const [{ data: students }, { data: enrollments }, { data: programs }, { data: attempts }, { data: evaluations }] = await Promise.all([
    fetchAllRows("students", "id, student_no, name, department, topik_level, employment_status"),
    fetchAllRows("enrollments", "student_id, program_id, completed_hours, status"),
    fetchAllRows("programs", "id, required_hours, equivalent_group"),
    fetchAllRows("exam_attempts", "student_id, score"),
    fetchAllRows("student_evaluations", "*"),
  ]);

  const scopedStudents = myDepartment ? (students || []).filter((s) => s.department === myDepartment) : students || [];

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

  evalStudentsCache = scopedStudents.map((s) => {
    const rows = (enrollments || []).filter((e) => e.student_id === s.id);
    const { totalCompleted } = computeGroupedCompletion(programs, rows);
    const examRows = (attempts || []).filter((a) => a.student_id === s.id);
    const avgScore = examRows.length ? Math.round((examRows.reduce((sum, a) => sum + Number(a.score), 0) / examRows.length) * 10) / 10 : null;
    const evaluation = (evaluations || []).find((ev) => ev.student_id === s.id) || null;

    return { ...s, completedHours: totalCompleted, avgScore, evaluation };
  });

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
        <td class="text-end">${s.avgScore ?? "-"}</td>
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
  document.getElementById("evalInfoExam").textContent = s.avgScore !== null ? `${s.avgScore}점` : "미응시";
  document.getElementById("evalInfoTopik").textContent = s.topik_level ?? "-";

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
  let grade = null;
  if (total >= 90) grade = "S";
  else if (total >= 80) grade = "A";
  else if (total >= 70) grade = "B";
  return { total, grade };
}

function updateEvalTotalPreview() {
  const { total, grade } = computeTotalAndGrade();
  document.getElementById("evalTotalScore").textContent = total;

  const badge = document.getElementById("evalGradeBadge");
  const gradeText = { S: "S등급 (장려금 500,000원)", A: "A등급 (장려금 300,000원)", B: "B등급 (장려금 200,000원)" };
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
