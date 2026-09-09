// =========================================================
// admin/student-detail.html 전용 스크립트
// URL 쿼리스트링 ?student_no=XXXX 로 대상 학생을 식별합니다.
// =========================================================

let currentStudent = null;
let currentEnrollments = [];
let editingEnrollmentId = null;

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("students", auth.admin.name);

  const params = new URLSearchParams(window.location.search);
  const studentNo = params.get("student_no");
  if (!studentNo) {
    document.getElementById("basicInfoPanel").innerHTML = `<p class="text-danger">학번 정보가 없습니다.</p>`;
    return;
  }

  await loadStudentDetail(studentNo);

  document.getElementById("saveMemoBtn").addEventListener("click", saveMemo);
  document.getElementById("saveEnrollBtn").addEventListener("click", saveEnrollment);
})();

async function loadStudentDetail(studentNo) {
  const { data: student, error } = await supabaseClient
    .from("students")
    .select("*")
    .eq("student_no", studentNo)
    .maybeSingle();

  if (error || !student) {
    document.getElementById("basicInfoPanel").innerHTML = `<p class="text-danger">해당 학생을 찾을 수 없습니다.</p>`;
    return;
  }
  currentStudent = student;

  document.getElementById("basicInfoPanel").innerHTML = `
    <div class="row g-3">
      <div class="col-md-2"><div class="stat-label">학번</div><div style="font-weight:700;">${student.student_no}</div></div>
      <div class="col-md-2"><div class="stat-label">이름</div><div style="font-weight:700;">${student.name}</div></div>
      <div class="col-md-2"><div class="stat-label">학과</div><div>${student.department ?? "-"}</div></div>
      <div class="col-md-2"><div class="stat-label">국적</div><div>${student.nationality ?? "-"}</div></div>
      <div class="col-md-2"><div class="stat-label">TOPIK 급수</div><div>${student.topik_level ?? "-"}</div></div>
      <div class="col-md-2"><div class="stat-label">K-WORK 등록여부</div><div>${student.kwork_id ? "등록(" + student.kwork_id + ")" : "미등록"}</div></div>
    </div>`;

  document.getElementById("memoBox").value = student.memo ?? "";

  // 이수현황 + 프로그램 + 시험결과를 함께 조회
  const [{ data: enrollments }, { data: attempts }] = await Promise.all([
    supabaseClient.from("enrollments").select("id, program_id, completed_hours, status, attendance_status, programs(id, name, required_hours, has_exam, equivalent_group)").eq("student_id", student.id),
    supabaseClient.from("exam_attempts").select("program_id, exam_title, score, correct_count, total_count").eq("student_id", student.id),
  ]);

  currentEnrollments = enrollments || [];
  renderEnrollmentTable(currentEnrollments, attempts || []);
}

// 동일과목 그룹 안에서, 이 학생 기준으로 실제로 이수시간에 "반영되는" program_id 집합을 계산합니다.
// (computeGroupedCompletion과 같은 규칙: 패스가 아닌 트랙 중 이수시간이 가장 큰 트랙이 대표)
function getRepresentativeProgramIds(enrollments) {
  const groups = {};
  enrollments.forEach((e) => {
    const key = e.programs?.equivalent_group || `__solo_${e.program_id}`;
    groups[key] = groups[key] || [];
    groups[key].push(e);
  });

  const repIds = new Set();
  Object.values(groups).forEach((rows) => {
    const nonPass = rows.filter((r) => r.status !== "패스");
    if (nonPass.length) {
      const rep = nonPass.reduce((max, r) => (Number(r.completed_hours || 0) > Number(max.completed_hours || 0) ? r : max), nonPass[0]);
      repIds.add(rep.program_id);
    }
  });
  return repIds;
}

function renderEnrollmentTable(enrollments, attempts) {
  const tbody = document.getElementById("enrollmentBody");
  const repIds = getRepresentativeProgramIds(enrollments);

  if (!enrollments.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">등록된 교육 프로그램이 없습니다.</td></tr>`;
  } else {
    tbody.innerHTML = enrollments
      .map((e) => {
        const exam = attempts.find((a) => a.program_id === e.program_id);
        const examCell = e.programs?.has_exam ? (exam ? `응시완료 / ${exam.score}점` : "미응시") : "-";
        const group = e.programs?.equivalent_group;
        const isRep = repIds.has(e.program_id);
        const groupBadge = group
          ? `<br><span class="badge-status" style="background:#EEF2FB; color:var(--navy); font-size:11px;">동일과목: ${group}${!isRep ? " (미반영)" : ""}</span>`
          : "";
        return `<tr>
          <td>${e.programs?.name ?? ""}${groupBadge}</td>
          <td class="text-end">${e.programs?.required_hours ?? 0}시간</td>
          <td class="text-end">${e.completed_hours}시간</td>
          <td>${e.attendance_status ?? "-"}</td>
          <td><span class="badge-status badge-${e.status}">${e.status}</span></td>
          <td colspan="1">${examCell}</td>
          <td class="text-end"></td>
          <td><button class="btn btn-outline-navy btn-sm" onclick="openEditEnroll('${e.id}')">수정</button></td>
        </tr>`;
      })
      .join("");
  }

  // "동일과목 그룹"을 반영해 중복 없이 총 이수시간/이수율을 계산합니다.
  const programsList = enrollments.map((e) => ({
    id: e.program_id,
    required_hours: e.programs?.required_hours,
    equivalent_group: e.programs?.equivalent_group,
  }));
  const enrollmentRows = enrollments.map((e) => ({
    program_id: e.program_id,
    completed_hours: e.completed_hours,
    status: e.status,
  }));
  const { totalRequired, totalCompleted } = computeGroupedCompletion(programsList, enrollmentRows);
  const rate = totalRequired ? Math.round((totalCompleted / totalRequired) * 1000) / 10 : 0;

  document.getElementById("hoursText").textContent = `${totalCompleted}시간 / ${totalRequired}시간`;
  document.getElementById("rateText").textContent = `전체 이수율 ${rate}%`;
  document.getElementById("rateBar").style.width = Math.min(rate, 100) + "%";
}

function openEditEnroll(enrollmentId) {
  const row = currentEnrollments.find((e) => e.id === enrollmentId);
  if (!row) return;
  editingEnrollmentId = enrollmentId;
  document.getElementById("editEnrollTitle").textContent = row.programs?.name + " 이수현황 수정";
  document.getElementById("editAttendance").value = row.attendance_status ?? "결석";
  document.getElementById("editHours").value = row.completed_hours ?? 0;
  new bootstrap.Modal(document.getElementById("editEnrollModal")).show();
}

async function saveEnrollment() {
  const attendance = document.getElementById("editAttendance").value;
  const hours = Number(document.getElementById("editHours").value || 0);

  const { error } = await supabaseClient
    .from("enrollments")
    .update({ attendance_status: attendance, completed_hours: hours })
    .eq("id", editingEnrollmentId);

  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById("editEnrollModal")).hide();
  await loadStudentDetail(currentStudent.student_no);
}

async function saveMemo() {
  const memo = document.getElementById("memoBox").value;
  const { error } = await supabaseClient.from("students").update({ memo }).eq("id", currentStudent.id);
  if (error) alert("메모 저장 실패: " + error.message);
  else alert("메모가 저장되었습니다.");
}
