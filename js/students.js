// =========================================================
// admin/students.html 전용 스크립트
// =========================================================

let allStudentsCache = []; // 화면 표시용 가공 데이터 캐시 (검색/필터에 재사용)
let programsListCache = []; // 엑셀 양식/업로드 시 "프로그램별 이수시간" 컬럼을 만들기 위한 프로그램 목록
let activeCompletionTab = ""; // 현재 선택된 수료구분 탭 ("" = 전체)

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
  "졸업구분": "graduation_type",
  "졸업예정": "graduation_type",
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

  document.querySelectorAll("#completionTabs .nav-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#completionTabs .nav-link").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCompletionTab = btn.dataset.type;
      applyFilters();
    });
  });
})();

// ---------------------------------------------------------
// 학생 + 이수현황 + 학습평가 데이터를 합쳐서 화면용 데이터로 가공
// ---------------------------------------------------------
async function loadStudents() {
  const [{ data: students }, { data: enrollments }, { data: attempts }, { data: programs }] = await Promise.all([
    fetchAllRows("students", "*"),
    fetchAllRows("enrollments", "student_id, program_id, completed_hours, status"),
    fetchAllRows("exam_attempts", "student_id, score"),
    fetchAllRows("programs", "id, name, required_hours, equivalent_group"),
  ]);

  programsListCache = programs || [];

  const completionTypeUpdates = []; // 자동 계산 결과가 기존 값과 달라 DB에 반영해야 하는 것들

  allStudentsCache = (students || [])
    .slice()
    .sort((a, b) => (a.student_no > b.student_no ? 1 : -1))
    .map((s) => {
    const rows = (enrollments || []).filter((e) => e.student_id === s.id);
    // "동일과목 그룹"을 반영해 중복 없이 이수시간/이수율/이수여부를 계산합니다.
    const { totalRequired, totalCompleted, overallStatus, anyGroupCompleted } = computeGroupedCompletion(programs, rows);
    const completedHours = totalCompleted;
    const rate = totalRequired ? Math.round((completedHours / totalRequired) * 1000) / 10 : 0;

    const examRows = (attempts || []).filter((a) => a.student_id === s.id);
    const avgScore = examRows.length ? Math.round((examRows.reduce((sum, a) => sum + Number(a.score), 0) / examRows.length) * 10) / 10 : null;

    // 수료구분 자동 판정: "조기취업"은 관리자가 직접 지정한 예외이므로 자동으로 덮어쓰지 않습니다.
    let completionType = s.completion_type;
    if (completionType !== "조기취업") {
      const autoType = determineAutoCompletionType(completedHours, anyGroupCompleted);
      if (autoType !== completionType) {
        completionType = autoType;
        completionTypeUpdates.push({ id: s.id, completion_type: autoType });
      }
    }

    return { ...s, completedHours, rate, overallStatus, avgScore, completion_type: completionType };
  });

  renderStudentsTable(allStudentsCache);

  // 자동 계산으로 바뀐 수료구분을 DB에도 반영 (다음에 볼 때도, 엑셀 다운로드에도 정확히 나오도록)
  if (completionTypeUpdates.length) {
    await Promise.all(
      completionTypeUpdates.map((u) => supabaseClient.from("students").update({ completion_type: u.completion_type }).eq("id", u.id))
    );
  }
}

function renderStudentsTable(list) {
  const tbody = document.getElementById("studentsBody");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-3">등록된 학생이 없습니다.</td></tr>`;
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
        <td>${s.graduation_type ?? "-"}</td>
        <td>${s.kwork_id ? "등록" : "-"}</td>
        <td class="text-end">${s.completedHours}시간</td>
        <td class="text-end">${s.rate}%</td>
        <td class="text-end">${s.avgScore ?? "-"}</td>
        <td>
          <select class="form-select form-select-sm completion-select completion-${s.completion_type}" style="min-width:110px;" onchange="updateCompletionType('${s.id}', this)">
            ${["정규수료", "단일수료", "미수료", "조기취업"].map((t) => `<option value="${t}" ${s.completion_type === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </td>
      </tr>`
    )
    .join("");
}

function applyFilters() {
  const q = document.getElementById("fSearch").value.trim().toLowerCase();
  const dept = document.getElementById("fDept").value.trim().toLowerCase();
  const nat = document.getElementById("fNationality").value.trim().toLowerCase();
  const topik = document.getElementById("fTopik").value;

  const filtered = allStudentsCache.filter((s) => {
    if (activeCompletionTab && s.completion_type !== activeCompletionTab) return false;
    if (q && !(s.name?.toLowerCase().includes(q) || s.student_no?.toLowerCase().includes(q))) return false;
    if (dept && !(s.department ?? "").toLowerCase().includes(dept)) return false;
    if (nat && !(s.nationality ?? "").toLowerCase().includes(nat)) return false;
    if (topik && s.topik_level !== topik) return false;
    return true;
  });

  renderStudentsTable(filtered);
}

// ---------------------------------------------------------
// 수료구분 변경 (관리자가 직접 지정) - select 자체의 색상도 함께 갱신
// ---------------------------------------------------------
async function updateCompletionType(studentId, selectEl) {
  const completionType = selectEl.value;
  const { error } = await supabaseClient.from("students").update({ completion_type: completionType }).eq("id", studentId);
  if (error) {
    alert("수료구분 변경 실패: " + error.message);
    return;
  }
  selectEl.className = `form-select form-select-sm completion-select completion-${completionType}`;
  const target = allStudentsCache.find((s) => s.id === studentId);
  if (target) target.completion_type = completionType;
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

  // "이수시간_프로그램명" / "이수여부_프로그램명" 형태의 컬럼을 프로그램 ID로 매칭하기 위한 맵
  const hoursColToProgramId = {};
  const statusColToProgramId = {};
  programsListCache.forEach((p) => {
    hoursColToProgramId[`이수시간_${p.name}`] = p.id;
    statusColToProgramId[`이수여부_${p.name}`] = p.id;
  });

  const VALID_STATUSES = ["이수", "패스", "진행중", "미이수"];

  const payloads = [];
  const enrollmentPatchMap = new Map(); // key: "학번||program_id" -> { completed_hours?, status? }

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
      if (statusColToProgramId[header] !== undefined) {
        const statusValue = String(value).trim();
        if (statusValue && VALID_STATUSES.includes(statusValue)) {
          getPatch(String(row["학번"]).trim(), statusColToProgramId[header]).status = statusValue;
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

  // 2) 프로그램별 이수여부/이수시간 컬럼이 있었다면 enrollments 테이블도 함께 갱신
  if (enrollmentPatchMap.size) {
    const { data: freshStudents } = await supabaseClient.from("students").select("id, student_no");
    const noToId = {};
    (freshStudents || []).forEach((s) => (noToId[s.student_no] = s.id));

    const rowsToUpsert = Array.from(enrollmentPatchMap.values())
      .map(({ student_no, program_id, completed_hours, status }) => {
        const patch = { student_id: noToId[student_no], program_id };
        if (completed_hours !== undefined) patch.completed_hours = completed_hours;
        if (status !== undefined) patch.status = status;
        return patch;
      })
      .filter((u) => u.student_id && (u.completed_hours !== undefined || u.status !== undefined));

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
    "졸업구분": "8월 졸업",
    "총 이수시간": "",
    "학습평가 점수": "",
  };
  // 프로그램별 이수여부 / 이수시간 컬럼을 현재 등록된 프로그램 기준으로 자동 추가
  programsListCache.forEach((p) => {
    header[`이수여부_${p.name}`] = "이수";
    header[`이수시간_${p.name}`] = p.required_hours ?? "";
  });

  const ws = XLSX.utils.json_to_sheet([header]);
  const guideWs = XLSX.utils.aoa_to_sheet([
    ["안내"],
    ["- 이수여부_프로그램명 컬럼에는 이수 / 패스 / 진행중 / 미이수 중 하나만 입력하세요."],
    ["- 이수시간_프로그램명 컬럼에는 실제 이수한 시간을 숫자로 입력하세요."],
    ["- 졸업구분 컬럼에는 '8월 졸업' 또는 '2월 졸업' 중 하나를 입력하세요."],
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
    "수료구분": s.completion_type,
    "졸업구분": s.graduation_type,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "학생현황");
  XLSX.writeFile(wb, `전체학생현황_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
