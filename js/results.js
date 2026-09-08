// =========================================================
// admin/results.html 전용 스크립트
// =========================================================

let examsForSelect = [];
let attemptsCache = [];
let absentStudentsCache = [];

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("results", auth.admin.name);

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

  // 해당 시험의 응시결과
  const { data: attempts } = await supabaseClient
    .from("exam_attempts")
    .select("student_no, score, correct_count, total_count, submitted_at, students(name)")
    .eq("exam_id", examId)
    .order("submitted_at", { ascending: false });
  attemptsCache = attempts || [];

  // 응시대상자 = 전체 교육 프로그램을 모두 이수한 학생 (학습평가는 프로그램 단위가 아니라
  // 전체 과정 이수 후 응시하는 종합 시험이므로, 대상자는 "전체 이수 완료자" 기준입니다.
  const [{ data: students }, { data: programs }, { data: enrollments }] = await Promise.all([
    supabaseClient.from("students").select("student_no, name"),
    supabaseClient.from("programs").select("id, required_hours"),
    supabaseClient.from("enrollments").select("student_id, program_id, completed_hours, students(student_no, name)"),
  ]);

  const target = (students || []).filter((s) => {
    const rows = (enrollments || []).filter((e) => e.students?.student_no === s.student_no);
    return (programs || []).every((p) => {
      const r = rows.find((x) => x.program_id === p.id);
      return r && Number(r.completed_hours || 0) >= Number(p.required_hours || 0);
    });
  });

  const takenNos = new Set(attemptsCache.map((a) => a.student_no));
  absentStudentsCache = target.filter((s) => !takenNos.has(s.student_no));

  renderStats(target.length);
  renderResultsTable();
}

function renderStats(targetCount) {
  const takers = attemptsCache.length;
  const absent = Math.max(targetCount - takers, 0);
  const rate = targetCount ? Math.round((takers / targetCount) * 1000) / 10 : 0;
  const scores = attemptsCache.map((a) => Number(a.score));
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
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">미응시 학생이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = absentStudentsCache
      .map(
        (s) => `<tr>
          <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(s.student_no)}">${s.student_no}</a></td>
          <td>${s.name}</td>
          <td>${examTitle}</td>
          <td class="text-end">-</td><td class="text-end">-</td><td><span class="badge-status badge-미이수">미응시</span></td>
        </tr>`
      )
      .join("");
    return;
  }

  if (!attemptsCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">응시 결과가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = attemptsCache
    .map(
      (a) => `<tr>
        <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(a.student_no)}">${a.student_no}</a></td>
        <td>${a.students?.name ?? ""}</td>
        <td>${examTitle}</td>
        <td class="text-end">${a.score}점</td>
        <td class="text-end">${a.correct_count}/${a.total_count}</td>
        <td>${new Date(a.submitted_at).toLocaleString("ko-KR")}</td>
      </tr>`
    )
    .join("");
}

function downloadResults() {
  const examTitle = examsForSelect.find((e) => e.id === document.getElementById("examSelect").value)?.title ?? "시험결과";
  const rows = attemptsCache.map((a) => ({
    "학번": a.student_no,
    "이름": a.students?.name ?? "",
    "시험명": examTitle,
    "점수": a.score,
    "정답수": `${a.correct_count}/${a.total_count}`,
    "제출일시": new Date(a.submitted_at).toLocaleString("ko-KR"),
  }));
  if (!rows.length) { alert("다운로드할 결과가 없습니다."); return; }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "시험결과");
  XLSX.writeFile(wb, `${examTitle}_결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
