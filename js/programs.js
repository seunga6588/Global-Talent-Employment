// =========================================================
// admin/programs.html 전용 스크립트
// =========================================================

let programsCache = [];
let enrollmentCountsByProgram = {}; // { program_id: 이수 완료 학생 수 }

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("programs", auth.admin.name);

  await loadPrograms();
  document.getElementById("saveProgramBtn").addEventListener("click", saveProgram);
  document.getElementById("downloadProgramTemplateBtn").addEventListener("click", downloadProgramTemplate);
  document.getElementById("uploadProgramExcelBtn").addEventListener("click", uploadProgramExcel);
})();

async function loadPrograms() {
  const [{ data: programs, error }, { data: enrollments }] = await Promise.all([
    supabaseClient.from("programs").select("*").order("edu_date", { ascending: true }),
    supabaseClient.from("enrollments").select("program_id, status"),
  ]);
  if (error) {
    document.getElementById("programsBody").innerHTML = `<tr><td colspan="4" class="text-danger text-center py-3">불러오기 실패: ${error.message}</td></tr>`;
    return;
  }
  programsCache = programs || [];

  enrollmentCountsByProgram = {};
  (enrollments || []).forEach((e) => {
    if (e.status === "이수") {
      enrollmentCountsByProgram[e.program_id] = (enrollmentCountsByProgram[e.program_id] || 0) + 1;
    }
  });

  renderProgramsTable();
}

function renderProgramsTable() {
  const tbody = document.getElementById("programsBody");
  if (!programsCache.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">등록된 프로그램이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = programsCache
    .map((p) => {
      let scheduleText;
      if (p.has_sections && Array.isArray(p.sections) && p.sections.length) {
        scheduleText = p.sections.map((s) => `${s.department}: ${s.start_date ?? "-"} ~ ${s.end_date ?? "-"}`).join("<br>");
      } else {
        scheduleText = `${p.edu_date ?? "-"} ~ ${p.edu_end_date ?? "-"}`;
      }
      return `<tr>
        <td>${p.name}</td>
        <td style="font-size:12.5px;">${scheduleText}</td>
        <td class="text-end">${enrollmentCountsByProgram[p.id] || 0}명</td>
        <td class="text-nowrap">
          <button class="btn btn-outline-navy btn-sm" onclick="openEditProgram('${p.id}')">수정</button>
          <button class="btn btn-outline-secondary btn-sm" onclick="deleteProgram('${p.id}')">삭제</button>
        </td>
      </tr>`;
    })
    .join("");
}

// ---------------------------------------------------------
// 분반(학과별 일정) UI
// ---------------------------------------------------------
function toggleSectionsUI(checked) {
  document.getElementById("sectionsContainer").style.display = checked ? "block" : "none";
  document.getElementById("programStartDate").disabled = checked;
  document.getElementById("programEndDate").disabled = checked;
  if (checked && document.getElementById("sectionsRows").children.length === 0) {
    addSectionRow();
  }
}

function addSectionRow(section) {
  const container = document.getElementById("sectionsRows");
  const row = document.createElement("div");
  row.className = "row g-2 mb-1 align-items-center section-row";
  row.innerHTML = `
    <div class="col-4"><input type="text" class="form-control form-control-sm section-dept" placeholder="학과명" value="${section?.department ?? ""}"></div>
    <div class="col-3"><input type="date" class="form-control form-control-sm section-start" value="${section?.start_date ?? ""}"></div>
    <div class="col-3"><input type="date" class="form-control form-control-sm section-end" value="${section?.end_date ?? ""}"></div>
    <div class="col-2"><button type="button" class="btn btn-outline-secondary btn-sm w-100" onclick="this.closest('.section-row').remove()">삭제</button></div>
  `;
  container.appendChild(row);
}

function collectSections() {
  return Array.from(document.querySelectorAll("#sectionsRows .section-row"))
    .map((row) => ({
      department: row.querySelector(".section-dept").value.trim(),
      start_date: row.querySelector(".section-start").value || null,
      end_date: row.querySelector(".section-end").value || null,
    }))
    .filter((s) => s.department);
}

function openAddProgram() {
  document.getElementById("programModalTitle").textContent = "프로그램 추가";
  document.getElementById("programForm").reset();
  document.getElementById("programForm").elements["id"].value = "";
  document.getElementById("hasSectionsCheck").checked = false;
  document.getElementById("sectionsRows").innerHTML = "";
  toggleSectionsUI(false);
}

function openEditProgram(id) {
  const p = programsCache.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("programModalTitle").textContent = "프로그램 수정";
  const form = document.getElementById("programForm");
  form.elements["id"].value = p.id;
  form.elements["name"].value = p.name ?? "";
  form.elements["category"].value = p.category ?? "교과";
  form.elements["edu_date"].value = p.edu_date ?? "";
  form.elements["edu_end_date"].value = p.edu_end_date ?? "";
  form.elements["required_hours"].value = p.required_hours ?? 0;
  form.elements["manager_name"].value = p.manager_name ?? "";
  form.elements["completion_criteria"].value = p.completion_criteria ?? "";

  document.getElementById("sectionsRows").innerHTML = "";
  const hasSections = !!p.has_sections;
  document.getElementById("hasSectionsCheck").checked = hasSections;
  toggleSectionsUI(hasSections);
  if (hasSections && Array.isArray(p.sections)) {
    p.sections.forEach((s) => addSectionRow(s));
  }

  new bootstrap.Modal(document.getElementById("programModal")).show();
}

async function saveProgram() {
  const form = document.getElementById("programForm");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  const id = payload.id;
  delete payload.id;

  payload.required_hours = Number(payload.required_hours || 0);
  if (!payload.edu_date) delete payload.edu_date;
  if (!payload.edu_end_date) delete payload.edu_end_date;

  payload.has_sections = document.getElementById("hasSectionsCheck").checked;
  if (payload.has_sections) {
    const sections = collectSections();
    if (!sections.length) {
      alert("분반을 사용하려면 학과별 일정을 최소 1개 이상 입력해주세요.");
      return;
    }
    payload.sections = sections;
  } else {
    payload.sections = [];
  }

  let error;
  if (id) {
    ({ error } = await supabaseClient.from("programs").update(payload).eq("id", id));
  } else {
    ({ error } = await supabaseClient.from("programs").insert(payload));
  }

  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById("programModal")).hide();
  await loadPrograms();
}

async function deleteProgram(id) {
  if (!confirm("이 프로그램을 삭제하시겠습니까? 관련된 학생 이수현황도 함께 삭제됩니다.")) return;
  const { error } = await supabaseClient.from("programs").delete().eq("id", id);
  if (error) {
    alert("삭제 실패: " + error.message);
    return;
  }
  await loadPrograms();
}

// ---------------------------------------------------------
// 엑셀 양식 다운로드
// ---------------------------------------------------------
function downloadProgramTemplate() {
  const rows = [
    {
      "프로그램명": "취업스킬UP1",
      "교육구분": "교과",
      "시작일": "2026-03-10",
      "종료일": "2026-03-10",
      "인정이수시간": 2,
      "이수기준": "필수시간 100% 참석",
      "담당자": "홍길동",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const guideWs = XLSX.utils.aoa_to_sheet([
    ["안내"],
    ["- 학과마다 일정이 다른 '분반' 프로그램은 엑셀 일괄등록으로 만들 수 없습니다."],
    ["  프로그램을 먼저 이 양식으로 등록한 뒤, 사이트에서 '수정' 버튼으로 열어"],
    ["  '분반 사용' 체크 후 학과별 일정을 직접 입력해주세요."],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "프로그램등록양식");
  XLSX.utils.book_append_sheet(wb, guideWs, "작성안내");
  XLSX.writeFile(wb, "교육프로그램_기본양식.xlsx");
}

// ---------------------------------------------------------
// 엑셀 일괄 업로드
// ---------------------------------------------------------
const PROGRAM_EXCEL_HEADER_MAP = {
  "프로그램명": "name",
  "교육구분": "category",
  "교육 구분": "category",
  "시작일": "edu_date",
  "교육일자": "edu_date",
  "교육 일자": "edu_date",
  "종료일": "edu_end_date",
  "인정이수시간": "required_hours",
  "인정 이수시간": "required_hours",
  "이수기준": "completion_criteria",
  "이수 기준": "completion_criteria",
  "담당자": "manager_name",
};

function excelDateToString(value) {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return String(value);
}

async function uploadProgramExcel() {
  const fileInput = document.getElementById("programExcelFile");
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

  const payloads = rows
    .map((row) => {
      const record = {};
      Object.entries(row).forEach(([rawHeader, value]) => {
        const col = PROGRAM_EXCEL_HEADER_MAP[rawHeader.trim()];
        if (col) record[col] = value;
      });
      if (record.required_hours !== undefined) record.required_hours = Number(record.required_hours) || 0;
      if (record.edu_date) record.edu_date = excelDateToString(record.edu_date);
      else delete record.edu_date;
      if (record.edu_end_date) record.edu_end_date = excelDateToString(record.edu_end_date);
      else delete record.edu_end_date;
      return record;
    })
    .filter((r) => r.name); // 프로그램명 없는 행은 제외

  if (!payloads.length) {
    alert("프로그램명 컬럼을 찾을 수 없습니다. 엑셀 헤더에 '프로그램명'이 포함되어 있는지 확인해주세요.");
    return;
  }

  const { error } = await supabaseClient.from("programs").insert(payloads);
  if (error) {
    alert("업로드 실패: " + error.message);
    return;
  }

  alert(`${payloads.length}건의 교육 프로그램이 등록되었습니다.`);
  fileInput.value = "";
  await loadPrograms();
}
