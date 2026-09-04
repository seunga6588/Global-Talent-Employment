// =========================================================
// admin/students.html 전용 스크립트
// =========================================================

let allStudentsCache = []; // 화면 표시용 가공 데이터 캐시 (검색/필터에 재사용)

// 엑셀 헤더(한글) -> DB 컬럼명 매핑. 여기 없는 컬럼은 extra_fields(jsonb)에 저장됩니다.
const EXCEL_HEADER_MAP = {
  "학번": "student_no",
  "이름": "name",
  "학과": "department",
  "성별": "gender",
  "국적": "nationality",
  "연락처": "phone",
  "K-WORK 플랫폼 ID": "kwork_id",
  "K-WORK ID": "kwork_id",
  "K-WORK 관련 정보": "kwork_note",
  "TOPIK 급수": "topik_level",
  "TOPIK": "topik_level",
  "비고": "memo",
};
const KNOWN_COLUMNS = Object.values(EXCEL_HEADER_MAP);

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("students", auth.admin.name);

  await loadStudents();

  document.getElementById("applyFilterBtn").addEventListener("click", applyFilters);
  document.getElementById("uploadExcelBtn").addEventListener("click", uploadExcel);
  document.getElementById("downloadExcelBtn").addEventListener("click", downloadExcel);
  document.getElementById("submitAddStudent").addEventListener("click", addStudent);
})();

// ---------------------------------------------------------
// 학생 + 이수현황 + 학습평가 데이터를 합쳐서 화면용 데이터로 가공
// ---------------------------------------------------------
async function loadStudents() {
  const [{ data: students }, { data: enrollments }, { data: attempts }, { data: programs }] = await Promise.all([
    supabaseClient.from("students").select("*").order("student_no"),
    supabaseClient.from("enrollments").select("student_id, completed_hours, status"),
    supabaseClient.from("exam_attempts").select("student_id, score"),
    supabaseClient.from("programs").select("id, required_hours"),
  ]);

  const totalRequired = (programs || []).reduce((s, p) => s + Number(p.required_hours || 0), 0);

  allStudentsCache = (students || []).map((s) => {
    const rows = (enrollments || []).filter((e) => e.student_id === s.id);
    const completedHours = rows.reduce((sum, r) => sum + Number(r.completed_hours || 0), 0);
    const rate = totalRequired ? Math.round((completedHours / totalRequired) * 1000) / 10 : 0;
    const overallStatus = rows.length === 0 ? "미이수" : rows.every((r) => r.status === "이수") ? "이수" : rows.some((r) => r.completed_hours > 0) ? "진행중" : "미이수";

    const examRows = (attempts || []).filter((a) => a.student_id === s.id);
    const avgScore = examRows.length ? Math.round((examRows.reduce((sum, a) => sum + Number(a.score), 0) / examRows.length) * 10) / 10 : null;

    return { ...s, completedHours, rate, overallStatus, avgScore };
  });

  renderStudentsTable(allStudentsCache);
}

function renderStudentsTable(list) {
  const tbody = document.getElementById("studentsBody");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-3">등록된 학생이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map(
      (s) => `<tr>
        <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(s.student_no)}">${s.student_no}</a></td>
        <td><a class="row-link" href="student-detail.html?student_no=${encodeURIComponent(s.student_no)}">${s.name}</a></td>
        <td>${s.department ?? ""}</td>
        <td>${s.nationality ?? ""}</td>
        <td>${s.topik_level ?? ""}</td>
        <td>${s.kwork_id ? "등록" : "-"}</td>
        <td class="text-end">${s.completedHours}시간</td>
        <td class="text-end">${s.rate}%</td>
        <td class="text-end">${s.avgScore ?? "-"}</td>
        <td><span class="badge-status badge-${s.overallStatus}">${s.overallStatus}</span></td>
      </tr>`
    )
    .join("");
}

function applyFilters() {
  const q = document.getElementById("fSearch").value.trim().toLowerCase();
  const dept = document.getElementById("fDept").value.trim().toLowerCase();
  const nat = document.getElementById("fNationality").value.trim().toLowerCase();
  const topik = document.getElementById("fTopik").value;
  const status = document.getElementById("fStatus").value;

  const filtered = allStudentsCache.filter((s) => {
    if (q && !(s.name?.toLowerCase().includes(q) || s.student_no?.toLowerCase().includes(q))) return false;
    if (dept && !(s.department ?? "").toLowerCase().includes(dept)) return false;
    if (nat && !(s.nationality ?? "").toLowerCase().includes(nat)) return false;
    if (topik && s.topik_level !== topik) return false;
    if (status && s.overallStatus !== status) return false;
    return true;
  });

  renderStudentsTable(filtered);
}

// ---------------------------------------------------------
// 학생 추가
// ---------------------------------------------------------
async function addStudent() {
  const form = document.getElementById("addStudentForm");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  if (!payload.student_no || !payload.name) {
    alert("학번과 이름은 필수입니다.");
    return;
  }

  const { error } = await supabaseClient.from("students").insert(payload);
  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById("addStudentModal")).hide();
  form.reset();
  await loadStudents();
}

// ---------------------------------------------------------
// 엑셀 일괄 업로드
// ---------------------------------------------------------
async function uploadExcel() {
  const fileInput = document.getElementById("excelFile");
  const file = fileInput.files[0];
  if (!file) {
    alert("업로드할 엑셀 파일을 선택해주세요.");
    return;
  }

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!rows.length) {
    alert("엑셀에 데이터가 없습니다.");
    return;
  }

  const payloads = rows.map((row) => {
    const record = { extra_fields: {} };
    Object.entries(row).forEach(([header, value]) => {
      const col = EXCEL_HEADER_MAP[header.trim()];
      if (col) {
        record[col] = String(value);
      } else {
        record.extra_fields[header] = value;
      }
    });
    return record;
  }).filter((r) => r.student_no); // 학번 없는 행은 제외

  if (!payloads.length) {
    alert("학번 컬럼을 찾을 수 없습니다. 엑셀 헤더에 '학번'이 포함되어 있는지 확인해주세요.");
    return;
  }

  // 학번(student_no) 기준으로 있으면 업데이트, 없으면 새로 등록 (upsert)
  const { error } = await supabaseClient.from("students").upsert(payloads, { onConflict: "student_no" });
  if (error) {
    alert("업로드 실패: " + error.message);
    return;
  }

  alert(`${payloads.length}건의 학생 정보가 등록/갱신되었습니다.`);
  fileInput.value = "";
  await loadStudents();
}

// ---------------------------------------------------------
// 엑셀 다운로드 (현재 화면에 표시된 데이터 기준)
// ---------------------------------------------------------
function downloadExcel() {
  const rows = allStudentsCache.map((s) => ({
    "학번": s.student_no,
    "이름": s.name,
    "학과": s.department,
    "국적": s.nationality,
    "TOPIK": s.topik_level,
    "K-WORK 등록여부": s.kwork_id ? "등록" : "미등록",
    "총 이수시간": s.completedHours,
    "전체 이수율(%)": s.rate,
    "평균 평가점수": s.avgScore ?? "",
    "상태": s.overallStatus,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "학생현황");
  XLSX.writeFile(wb, `전체학생현황_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
