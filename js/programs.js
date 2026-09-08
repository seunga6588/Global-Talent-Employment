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
    .map(
      (p) => `<tr>
        <td>${p.name}</td>
        <td>${p.edu_date ?? "-"}</td>
        <td class="text-end">${enrollmentCountsByProgram[p.id] || 0}명</td>
        <td class="text-nowrap">
          <button class="btn btn-outline-navy btn-sm" onclick="openEditProgram('${p.id}')">수정</button>
          <button class="btn btn-outline-secondary btn-sm" onclick="deleteProgram('${p.id}')">삭제</button>
        </td>
      </tr>`
    )
    .join("");
}

function openAddProgram() {
  document.getElementById("programModalTitle").textContent = "프로그램 추가";
  document.getElementById("programForm").reset();
  document.getElementById("programForm").elements["id"].value = "";
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
  form.elements["required_hours"].value = p.required_hours ?? 0;
  form.elements["manager_name"].value = p.manager_name ?? "";
  form.elements["completion_criteria"].value = p.completion_criteria ?? "";
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
      "교육일자": "2026-03-10",
      "인정이수시간": 2,
      "이수기준": "필수시간 100% 참석",
      "담당자": "홍길동",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "프로그램등록양식");
  XLSX.writeFile(wb, "교육프로그램_기본양식.xlsx");
}

// ---------------------------------------------------------
// 엑셀 일괄 업로드
// ---------------------------------------------------------
const PROGRAM_EXCEL_HEADER_MAP = {
  "프로그램명": "name",
  "교육구분": "category",
  "교육 구분": "category",
  "교육일자": "edu_date",
  "교육 일자": "edu_date",
  "인정이수시간": "required_hours",
  "인정 이수시간": "required_hours",
  "이수기준": "completion_criteria",
  "이수 기준": "completion_criteria",
  "담당자": "manager_name",
};

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
      if (record.edu_date) {
        // 엑셀 날짜가 숫자(엑셀 serial)로 들어오는 경우를 대비해 문자열로 변환 시도
        if (typeof record.edu_date === "number") {
          const d = XLSX.SSF.parse_date_code(record.edu_date);
          record.edu_date = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
        } else {
          record.edu_date = String(record.edu_date);
        }
      } else {
        delete record.edu_date;
      }
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
