// =========================================================
// admin/results.html 전용 스크립트
// -----------------------------------------------------------
// 재응시가 허용된 시험은 한 학생이 여러 번 응시할 수 있으므로,
// 목록/통계에는 "학생별 최고점수" 1건만 대표로 집계하고,
// 재응시 이력 전체는 별도 버튼으로 모달에서 확인할 수 있게 합니다.
// =========================================================

let examsForSelect = [];
let allAttemptsCache = [];   // 해당 시험의 전체 응시 기록 (재응시 포함 전체)
let bestAttemptsCache = [];  // 학생별 최고점 1건씩만 모은 목록 (통계/목록용)
let absentStudentsCache = [];
let myDepartment = null; // 담당 학과가 있으면(학부과장 계정) 본인 학과(또는 묶음) 학생만 보여줍니다.
let isFullAdmin = false;  // 전체 관리자만 응시 결과를 삭제할 수 있습니다.
let currentModalStudentNo = null;
let departmentGroupMap = {};

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("results", auth.admin.name, auth.admin.department);
  myDepartment = auth.admin.department || null;
  isFullAdmin = !auth.admin.department;

  await loadExamOptions();
  document.getElementById("examSelect").addEventListener("change", loadResultsForSelectedExam);
  document.getElementById("showAbsentOnly").addEventListener("change", renderResultsTable);
  document.getElementById("downloadResultsBtn").addEventListener("click", downloadResults);

  if (examsForSelect.length) await loadResultsForSelectedExam();
})();

async function loadExamOptions() {
  const { data } = await supabaseClient.from("exams").select("id, title").order("created_at", { ascending: false });
  examsForSelect = data || [];
  const sel = document.getElementById("examSelect");
  sel.innerHTML = examsForSelect.map((e) => `<option value="${e.id}">${e.title}</option>`).join("");
}

async function loadResultsForSelectedExam() {
  const examId = document.getElementById("examSelect").value;
  if (!examId) return;

  // 해당 시험의 전체 응시 기록 (재응시 포함)
  const { data: attempts } = await supabaseClient
    .from("exam_attempts")
    .select("id, student_no, score, correct_count, total_count, submitted_at, students(name, department)")
    .eq("exam_id", examId)
    .order("submitted_at", { ascending: false });

  // 응시대상자 = 총 이수시간이 120시간 이상인 학생 (학습평가는 프로그램 단위가 아니라
  // 총 이수시간 기준으로 응시하는 종합 시험이므로, 대상자는 "총 이수시간 120시간 이상"인 학생입니다.
  // ("동일과목 그룹"이 있으면 중복 없이 대표 트랙 하나만 이수시간에 반영합니다.)
  const REQUIRED_TOTAL_HOURS = 120;
  const [{ data: students }, { data: enrollments }, { data: programs }, { data: deptGroups }] = await Promise.all([
    fetchAllRows("students", "id, student_no, name, department"),
    fetchAllRows("enrollments", "student_id, program_id, completed_hours, status"),
    fetchAllRows("programs", "id, required_hours, equivalent_group"),
    fetchAllRows("department_groups", "*", null, "department"),
  ]);

  departmentGroupMap = {};
  (deptGroups || []).forEach((g) => (departmentGroupMap[g.department] = g.group_name));

  // 학부과장 계정이면 본인 학과(또는 묶음)의 응시결과만 남깁니다.
  allAttemptsCache = (attempts || []).filter((a) => !myDepartment || resolveQuotaGroupKey(a.students?.department, departmentGroupMap) === myDepartment);

  // 학생별로 최고점 1건만 추려서 "대표 기록"으로 사용 (통계/목록 표시용)
  const bestByStudentNo = new Map();
  allAttemptsCache.forEach((a) => {
    const existing = bestByStudentNo.get(a.student_no);
    if (!existing || Number(a.score) > Number(existing.score)) {
      bestByStudentNo.set(a.student_no, a);
    }
  });
  bestAttemptsCache = Array.from(bestByStudentNo.values());

  const enrollmentsByStudentId = {};
  (enrollments || []).forEach((e) => {
    enrollmentsByStudentId[e.student_id] = enrollmentsByStudentId[e.student_id] || [];
    enrollmentsByStudentId[e.student_id].push(e);
  });

  const target = (students || []).filter((s) => {
    if (myDepartment && resolveQuotaGroupKey(s.department, departmentGroupMap) !== myDepartment) return false;
    const { totalCompleted } = computeGroupedCompletion(programs, enrollmentsByStudentId[s.id] || []);
    return totalCompleted >= REQUIRED_TOTAL_HOURS;
  });

  const takenNos = new Set(bestAttemptsCache.map((a) => a.student_no));
  absentStudentsCache = target.filter((s) => !takenNos.has(s.student_no));

  renderStats(target.length);
  renderResultsTable();
}

function renderStats(targetCount) {
  // 응시자 수 등 통계는 "학생별 최고점" 기준으로만 계산해서 중복 카운트를 방지합니다.
  const takers = bestAttemptsCache.length;
  const absent = Math.max(targetCount - takers, 0);
  const rate = targetCount ? Math.round((takers / targetCount) * 1000) / 10 : 0;
  const scores = bestAttemptsCache.map((a) => Number(a.score));
  const avg = scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0;
  const max = scores.length ? Math.max(...scores) : 0;
  const min = scores.length ? Math.min(...scores) : 0;

  document.getElementById("statTarget").textContent = targetCount + "명";
  document.getElementById("statTakers").textContent = takers + "명";
  document.getElementById("statAbsent").textContent = absent + "명";
  document.getElementById("statRate").textContent = rate + "%";
  document.getElementById("statAvg").textContent = avg + "점";
  document.getElementById("statMinMax").textContent = `${max} / ${min}`;
}

function renderResultsTable() {
  const showAbsentOnly = document.getElementById("showAbsentOnly").checked;
  const tbody = document.getElementById("resultsBody");
  const examTitle = examsForSelect.find((e) => e.id === document.getElementById("examSelect").value)?.title ?? "";

  if (showAbsentOnly) {
    if (!absentStudentsCache.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">미응시 학생이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = absentStudentsCache
      .map(
        (s) => `<tr>
          <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(s.student_no)}">${s.student_no}</a></td>
          <td>${s.name}</td>
          <td>${s.department ?? "-"}</td>
          <td>${examTitle}</td>
          <td class="text-end">-</td><td class="text-end">-</td><td><span class="badge-status badge-미이수">미응시</span></td>
        </tr>`
      )
      .join("");
    return;
  }

  if (!bestAttemptsCache.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">응시 결과가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = bestAttemptsCache
    .map((a) => {
      const historyCount = allAttemptsCache.filter((x) => x.student_no === a.student_no).length;
      let historyBtn = "";
      if (isFullAdmin) {
        historyBtn = ` <button class="btn btn-outline-secondary btn-sm" style="padding:1px 8px; font-size:11px;" onclick="openAttemptModal('${a.student_no}')">이력/삭제${historyCount > 1 ? `(${historyCount}회)` : ""}</button>`;
      } else if (historyCount > 1) {
        historyBtn = ` <button class="btn btn-outline-secondary btn-sm" style="padding:1px 8px; font-size:11px;" onclick="openAttemptModal('${a.student_no}')">재응시 이력(${historyCount}회)</button>`;
      }
      return `<tr>
        <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(a.student_no)}">${a.student_no}</a></td>
        <td>${a.students?.name ?? ""}</td>
        <td>${a.students?.department ?? "-"}</td>
        <td>${examTitle}</td>
        <td class="text-end">${a.score}점 (최고점)${historyBtn}</td>
        <td class="text-end">${a.correct_count}/${a.total_count}</td>
        <td>${new Date(a.submitted_at).toLocaleString("ko-KR")}</td>
      </tr>`;
    })
    .join("");
}

// 응시 이력 모달 (전체 관리자는 회차별/전체 삭제 가능)
function openAttemptModal(studentNo) {
  currentModalStudentNo = studentNo;
  const history = allAttemptsCache
    .filter((a) => a.student_no === studentNo)
    .slice()
    .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));

  const name = history[0]?.students?.name ?? "";
  document.getElementById("attemptModalTitle").textContent = `${name} (${studentNo}) 응시 이력`;

  document.getElementById("attemptModalBody").innerHTML = history
    .map(
      (a, idx) => `<tr>
        <td>${idx + 1}회차</td>
        <td class="text-end">${a.score}점</td>
        <td class="text-end">${a.correct_count}/${a.total_count}</td>
        <td>${new Date(a.submitted_at).toLocaleString("ko-KR")}</td>
        <td>${isFullAdmin ? `<button class="btn btn-outline-secondary btn-sm" onclick="deleteAttempt('${a.id}')">삭제</button>` : ""}</td>
      </tr>`
    )
    .join("");

  document.getElementById("attemptModalNote").textContent = isFullAdmin
    ? "삭제하면 해당 응시 기록과 문항별 답안이 함께 지워지고, 학생은 다시 응시할 수 있게 됩니다. (테스트 데이터 정리용)"
    : "";

  document.getElementById("attemptModalFooter").innerHTML = isFullAdmin
    ? `<button class="btn btn-pink btn-sm" onclick="deleteAllAttemptsOfStudent()">이 학생 결과 전체 삭제</button>`
    : "";

  bootstrap.Modal.getOrCreateInstance(document.getElementById("attemptModal")).show();
}

async function deleteAttempt(attemptId) {
  if (!isFullAdmin) return;
  if (!confirm("이 응시 기록을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;

  const { error } = await supabaseClient.from("exam_attempts").delete().eq("id", attemptId);
  if (error) { alert("삭제 실패: " + error.message); return; }

  await afterAttemptDeleted();
}

async function deleteAllAttemptsOfStudent() {
  if (!isFullAdmin || !currentModalStudentNo) return;
  const examId = document.getElementById("examSelect").value;
  if (!confirm("이 학생의 선택한 시험 응시 기록을 전부 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;

  const { error } = await supabaseClient
    .from("exam_attempts")
    .delete()
    .eq("exam_id", examId)
    .eq("student_no", currentModalStudentNo);
  if (error) { alert("삭제 실패: " + error.message); return; }

  await afterAttemptDeleted();
}

async function afterAttemptDeleted() {
  await loadResultsForSelectedExam();
  const remaining = allAttemptsCache.filter((a) => a.student_no === currentModalStudentNo);
  if (remaining.length) {
    openAttemptModal(currentModalStudentNo); // 남은 이력으로 모달 갱신
  } else {
    bootstrap.Modal.getOrCreateInstance(document.getElementById("attemptModal")).hide();
  }
}

function downloadResults() {
  const examTitle = examsForSelect.find((e) => e.id === document.getElementById("examSelect").value)?.title ?? "시험결과";
  const rows = bestAttemptsCache.map((a) => ({
    "학번": a.student_no,
    "이름": a.students?.name ?? "",
    "학과": a.students?.department ?? "",
    "시험명": examTitle,
    "최고점수": a.score,
    "정답수": `${a.correct_count}/${a.total_count}`,
    "응시횟수": allAttemptsCache.filter((x) => x.student_no === a.student_no).length,
    "최고점 제출일시": new Date(a.submitted_at).toLocaleString("ko-KR"),
  }));
  if (!rows.length) { alert("다운로드할 결과가 없습니다."); return; }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "시험결과");
  XLSX.writeFile(wb, `${examTitle}_결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
