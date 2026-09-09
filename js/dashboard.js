// =========================================================
// admin/dashboard.html 전용 스크립트
// 전체 통계를 계산하고 Chart.js 로 그래프를 그립니다.
// =========================================================

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("dashboard", auth.admin.name);

  await loadDashboard();
})();

async function loadDashboard() {
  // 필요한 데이터를 한 번에 가져옵니다. (recentAttempts는 최근 10건만 필요하므로 그대로 직접 조회)
  const [{ data: students }, { data: programs }, { data: enrollments }, { data: recentAttempts }] = await Promise.all([
    fetchAllRows("students", "id, name, student_no, department, topik_level"),
    fetchAllRows("programs", "id, name, required_hours"),
    fetchAllRows("enrollments", "student_id, program_id, completed_hours, status"),
    supabaseClient.from("exam_attempts").select("student_id, student_no, exam_title, score, submitted_at, students(name)").order("submitted_at", { ascending: false }).limit(10),
  ]);

  renderStatCards(students, programs, enrollments);
  renderCompletionRateChart(programs, enrollments);
  renderExamAvgChart(programs);
  renderStudentHoursChart(students, enrollments);
  renderTopikChart(students);
  renderDepartmentChart(students, enrollments);
  renderRecentAttempts(recentAttempts);
}

function renderStatCards(students, programs, enrollments, attempts) {
  const totalStudents = students.length;

  // 학생별 전체 이수 여부 계산
  const byStudent = {};
  enrollments.forEach((e) => {
    byStudent[e.student_id] = byStudent[e.student_id] || [];
    byStudent[e.student_id].push(e);
  });

  let completed = 0, inProgress = 0, notStarted = 0;
  students.forEach((s) => {
    const rows = byStudent[s.id] || [];
    if (rows.length === 0) { notStarted++; return; }
    const allDone = rows.every((r) => r.status === "이수" || r.status === "패스");
    const anyProgress = rows.some((r) => r.completed_hours > 0 || r.status === "패스");
    if (allDone) completed++;
    else if (anyProgress) inProgress++;
    else notStarted++;
  });

  const totalHours = enrollments.reduce((sum, e) => sum + Number(e.completed_hours || 0), 0);
  const avgHours = totalStudents ? (totalHours / totalStudents).toFixed(1) : "0.0";

  document.getElementById("statTotalStudents").textContent = totalStudents + "명";
  document.getElementById("statCompleted").textContent = completed + "명";
  document.getElementById("statInProgress").textContent = inProgress + "명";
  document.getElementById("statNotStarted").textContent = notStarted + "명";
  document.getElementById("statTotalHours").textContent = totalHours + "시간";
  document.getElementById("statAvgHours").textContent = avgHours + "시간";

  // 학습평가 통계는 exam_attempts 전체를 다시 조회해 정확히 계산
  fetchAllRows("exam_attempts", "score").then(({ data: allAttempts }) => {
    const count = allAttempts ? allAttempts.length : 0;
    const avg = count ? (allAttempts.reduce((s, a) => s + Number(a.score), 0) / count).toFixed(1) : "0.0";
    document.getElementById("statExamTakers").textContent = count + "명";
    document.getElementById("statExamAvg").textContent = avg + "점";
  });
}

function renderCompletionRateChart(programs, enrollments) {
  const labels = programs.map((p) => p.name);
  const rates = programs.map((p) => {
    const rows = enrollments.filter((e) => e.program_id === p.id);
    if (rows.length === 0) return 0;
    const done = rows.filter((r) => r.status === "이수" || r.status === "패스").length;
    return Math.round((done / rows.length) * 1000) / 10;
  });

  new Chart(document.getElementById("chartCompletionRate"), {
    type: "bar",
    data: { labels, datasets: [{ label: "이수율(%)", data: rates, backgroundColor: "#11306E" }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
  });
}

async function renderExamAvgChart(programs) {
  const { data: attempts } = await fetchAllRows("exam_attempts", "program_id, score");
  const labels = programs.filter((p) => attempts.some((a) => a.program_id === p.id)).map((p) => p.name);
  const avgs = programs
    .filter((p) => attempts.some((a) => a.program_id === p.id))
    .map((p) => {
      const rows = attempts.filter((a) => a.program_id === p.id);
      return Math.round((rows.reduce((s, r) => s + Number(r.score), 0) / rows.length) * 10) / 10;
    });

  new Chart(document.getElementById("chartExamAvg"), {
    type: "bar",
    data: { labels, datasets: [{ label: "평균점수", data: avgs, backgroundColor: "#E6007E" }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
  });
}

function renderStudentHoursChart(students, enrollments) {
  const byStudent = {};
  enrollments.forEach((e) => {
    byStudent[e.student_id] = (byStudent[e.student_id] || 0) + Number(e.completed_hours || 0);
  });
  const idToStudent = {};
  students.forEach((s) => (idToStudent[s.id] = s));

  const ranked = Object.entries(byStudent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  new Chart(document.getElementById("chartStudentHours"), {
    type: "bar",
    data: {
      labels: ranked.map(([id]) => {
        const s = idToStudent[id];
        return s ? `${s.student_no} ${s.name} (${s.department ?? "학과미입력"})` : id;
      }),
      datasets: [{ label: "이수시간", data: ranked.map(([, h]) => h), backgroundColor: "#11306E" }],
    },
    options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } } },
  });
}

function renderTopikChart(students) {
  const counts = {};
  students.forEach((s) => {
    const level = s.topik_level || "미응시/미입력";
    counts[level] = (counts[level] || 0) + 1;
  });

  new Chart(document.getElementById("chartTopik"), {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{ data: Object.values(counts), backgroundColor: ["#11306E", "#E6007E", "#3B5FCB", "#F06CAA", "#6B7280", "#9CA9C9"] }],
    },
    options: { responsive: true },
  });
}

function renderDepartmentChart(students, enrollments) {
  // 학과별로 "전체 이수 완료(이수 또는 패스)" 비율을 계산합니다.
  const byStudentRows = {};
  enrollments.forEach((e) => {
    byStudentRows[e.student_id] = byStudentRows[e.student_id] || [];
    byStudentRows[e.student_id].push(e);
  });

  const deptStats = {}; // { 학과: { total, completed } }
  students.forEach((s) => {
    const dept = s.department || "미입력";
    deptStats[dept] = deptStats[dept] || { total: 0, completed: 0 };
    deptStats[dept].total += 1;

    const rows = byStudentRows[s.id] || [];
    const allDone = rows.length > 0 && rows.every((r) => r.status === "이수" || r.status === "패스");
    if (allDone) deptStats[dept].completed += 1;
  });

  const labels = Object.keys(deptStats);
  const rates = labels.map((d) => Math.round((deptStats[d].completed / deptStats[d].total) * 1000) / 10);
  const studentCounts = labels.map((d) => deptStats[d].total);

  new Chart(document.getElementById("chartDepartment"), {
    type: "bar",
    data: {
      labels: labels.map((d, i) => `${d} (${studentCounts[i]}명)`),
      datasets: [{ label: "이수율(%)", data: rates, backgroundColor: "#E6007E" }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, max: 100 } },
    },
  });
}

function renderRecentAttempts(attempts) {
  const tbody = document.getElementById("recentAttemptsBody");
  if (!attempts || attempts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">아직 제출된 시험이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = attempts
    .map(
      (a) => `<tr>
        <td>${a.student_no}</td>
        <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(a.student_no)}">${a.students?.name ?? ""}</a></td>
        <td>${a.exam_title ?? ""}</td>
        <td>${a.score}점</td>
        <td>${new Date(a.submitted_at).toLocaleString("ko-KR")}</td>
      </tr>`
    )
    .join("");
}
