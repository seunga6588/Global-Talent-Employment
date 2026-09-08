// =========================================================
// admin/students.html 전용 스크립트
// =========================================================

let allStudentsCache = []; // 화면 표시용 가공 데이터 캐시 (검색/필터에 재사용)
let programsListCache = []; // 엑셀 양식/업로드 시 "프로그램별 이수시간" 컬럼을 만들기 위한 프로그램 목록

// 엑셀 헤더(한글) -> DB 컬럼명 매핑. 여기 없는 컬럼은 extra_fields(jsonb)에 저장됩니다.
const EXCEL_HEADER_MAP = {
  "학번": "student_no",
  "이름": "name",
  "학과": "department",
  "성별": "gender",
  "국적": "nationality",
  "연락처": "phone",
  "K-WORK 플랫폼 ID": "kwork_id",
  "K-WORK 플랫폼 아이디": "kwork_id",
  "K-WORK ID": "kwork_id",
  "K-WORK 관련 정보": "kwork_note",
  "TOPIK 급수": "topik_level",
  "TOPIK": "topik_level",
  "비고": "memo",
};
// 아래 컬럼들은 실제로는 다른 테이블(enrollments, exam_attempts)에서 자동 계산되는 값이라
// 엑셀 업로드 시 학생 테이블에 직접 저장하지 않고 "참고용/무시" 처리합니다.
const IGNORED_ON_UPLOAD = ["총 이수시간", "학습평가 점수"];

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("students", auth.admin.name);

  await loadStudents();

  document.getElementById("applyFilterBtn").addEventListener("click", applyFilters);
  document.getElementById("uploadExcelBtn").addEventListener("click", uploadExcel);
  document.getElementById("downloadExcelBtn").addEventListener("click", downloadExcel);
  document.getElementById("downloadTemplateBtn").addEventListener("click", downloadTemplate);
  document.getElementById("submitAddStudent").addEventListener("click", addStudent);
})();

// ---------------------------------------------------------
// 학생 + 이수현황 + 학습평가 데이터를 합쳐서 화면용 데이터로 가공
// ---------------------------------------------------------
async function loadStudents() {
  const [{ data: students }, { data: enrollments }, { data: attempts }, { data: programs }] = await Promise.all([
    supabaseClient.from("students").select("*").order("student_no"),
    supabaseClient.from("enrollments").select("student_id, program_id, completed_hours, status"),
    supabaseClient.from("exam_attempts").select("student_id, score"),
    supabaseClient.from("programs").select("id, name, required_hours").order("name"),
  ]);

  programsListCache = programs || [];
  const totalRequired = (programs || []).reduce((s, p) => s + Number(p.required_hours || 0), 0);

  allStudentsCache = (students || []).map((s) => {
    const rows = (enrollments || []).filter((e) => e.student_id === s.id);
    const completedHours = rows.reduce((sum, r) => sum + Number(r.completed_hours || 0), 0);
    const rate = totalRequired ? Math.round((completedHours / totalRequired) * 1000) / 10 : 0;
    const overallStatus = rows.length === 0 ? "미이수" : rows.every((r) => r.status === "이수" || r.status === "패스") ? "이수" : rows.some((r) => r.completed_hours > 0 || r.status === "패스") ? "진행중" : "미이수";

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

  // "이수시간_프로그램명" / "참석상태_프로그램명" 형태의 컬럼을 프로그램 ID로 매칭하기 위한 맵
  const hoursColToProgramId = {};
  const attendanceColToProgramId = {};
  programsListCache.forEach((p) => {
    hoursColToProgramId[`이수시간_${p.name}`] = p.id;
    attendanceColToProgramId[`참석상태_${p.name}`] = p.id;
  });

  const payloads = [];
  const enrollmentPatchMap = new Map(); // key: "학번||program_id" -> { completed_hours?, attendance_status? }

  function getPatch(studentNo, programId) {
    const key = `${studentNo}||${programId}`;
    if (!enrollmentPatchMap.has(key)) enrollmentPatchMap.set(key, { student_no: studentNo, program_id: programId });
    return enrollmentPatchMap.get(key);
  }

  rows.forEach((row) => {
    const record = { extra_fields: {} };
    Object.entries(row).forEach(([rawHeader, value]) => {
      const header = rawHeader.trim();
      if (IGNORED_ON_UPLOAD.includes(header)) return; // 자동계산 값이므로 무시

      if (hoursColToProgramId[header] !== undefined) {
        if (value !== "" && value !== undefined) {
          getPatch(String(row["학번"]).trim(), hoursColToProgramId[header]).completed_hours = Number(value) || 0;
        }
        return;
      }
      if (attendanceColToProgramId[header] !== undefined) {
        if (value !== "" && value !== undefined) {
          getPatch(String(row["학번"]).trim(), attendanceColToProgramId[header]).attendance_status = String(value).trim();
        }
        return;
      }

      const col = EXCEL_HEADER_MAP[header];
      if (col) {
        record[col] = String(value);
      } else {
        record.extra_fields[header] = value;
      }
    });
    if (record.student_no) payloads.push(record);
  });

  if (!payloads.length) {
    alert("학번 컬럼을 찾을 수 없습니다. 엑셀 헤더에 '학번'이 포함되어 있는지 확인해주세요.");
    return;
  }

  // 1) 학번(student_no) 기준으로 있으면 업데이트, 없으면 새로 등록 (upsert)
  const { error } = await supabaseClient.from("students").upsert(payloads, { onConflict: "student_no" });
  if (error) {
    alert("업로드 실패: " + error.message);
    return;
  }

  // 2) 프로그램별 참석상태/이수시간 컬럼이 있었다면 enrollments 테이블도 함께 갱신
  //    (이수여부는 참석상태·이수시간에 따라 DB에서 자동으로 계산되므로 여기서 직접 넣지 않습니다.
  //     예: 참석상태를 '패스'로 넣으면 이수여부도 자동으로 '패스'가 됩니다.)
  if (enrollmentPatchMap.size) {
    const { data: freshStudents } = await supabaseClient.from("students").select("id, student_no");
    const noToId = {};
    (freshStudents || []).forEach((s) => (noToId[s.student_no] = s.id));

    const rowsToUpsert = Array.from(enrollmentPatchMap.values())
      .map(({ student_no, program_id, completed_hours, attendance_status }) => {
        const patch = { student_id: noToId[student_no], program_id };
        if (completed_hours !== undefined) patch.completed_hours = completed_hours;
        if (attendance_status !== undefined) patch.attendance_status = attendance_status;
        return patch;
      })
      .filter((u) => u.student_id && (u.completed_hours !== undefined || u.attendance_status !== undefined));

    if (rowsToUpsert.length) {
      const { error: enrollError } = await supabaseClient.from("enrollments").upsert(rowsToUpsert, { onConflict: "student_id,program_id" });
      if (enrollError) {
        alert("학생 정보는 저장되었지만, 이수현황 반영 중 오류가 발생했습니다: " + enrollError.message);
      }
    }
  }

  alert(`${payloads.length}건의 학생 정보가 등록/갱신되었습니다.`);
  fileInput.value = "";
  await loadStudents();
}

// ---------------------------------------------------------
// 엑셀 일괄등록용 기본 양식 다운로드
// ---------------------------------------------------------
function downloadTemplate() {
  const header = {
    "학번": "202612345",
    "이름": "홍길동",
    "학과": "컴퓨터소프트웨어과",
    "국적": "베트남",
    "TOPIK 급수": "4급",
    "K-WORK 플랫폼 아이디": "kwork_hong",
    "총 이수시간": "",
    "학습평가 점수": "",
  };
  // 프로그램별 참석상태 / 이수시간 컬럼을 현재 등록된 프로그램 기준으로 자동 추가
  // 참석상태는 "참석" / "결석" / "일부참석" / "패스" 중 하나로 입력하세요.
  // ("패스"로 입력하면 이수시간과 무관하게 이수여부도 자동으로 "패스" 처리됩니다.)
  programsListCache.forEach((p) => {
    header[`참석상태_${p.name}`] = "참석";
    header[`이수시간_${p.name}`] = p.required_hours ?? "";
  });

  const ws = XLSX.utils.json_to_sheet([header]);
  // 참석상태 입력 안내를 위한 안내 시트 추가
  const guideWs = XLSX.utils.aoa_to_sheet([
    ["안내"],
    ["- 참석상태_프로그램명 컬럼에는 참석 / 결석 / 일부참석 / 패스 중 하나만 입력하세요."],
    ["- '패스'로 입력하면 이수시간과 관계없이 이수여부도 자동으로 '패스'로 표시됩니다."],
    ["- 이수시간_프로그램명 컬럼에는 실제 이수한 시간을 숫자로 입력하세요."],
    ["- 이수여부는 참석상태/이수시간에 따라 시스템이 자동으로 계산하므로 별도 입력란이 없습니다."],
    ["- 총 이수시간, 학습평가 점수 컬럼은 자동 계산되는 값이라 입력해도 무시됩니다."],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "학생등록양식");
  XLSX.utils.book_append_sheet(wb, guideWs, "작성안내");
  XLSX.writeFile(wb, "학생등록_기본양식.xlsx");
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
