// =========================================================
// admin/programs.html 전용 스크립트
// =========================================================

let programsCache = [];

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("programs", auth.admin.name);

  await loadPrograms();
  document.getElementById("saveProgramBtn").addEventListener("click", saveProgram);
})();

async function loadPrograms() {
  const { data, error } = await supabaseClient.from("programs").select("*").order("edu_date", { ascending: true });
  if (error) {
    document.getElementById("programsBody").innerHTML = `<tr><td colspan="9" class="text-danger text-center py-3">불러오기 실패: ${error.message}</td></tr>`;
    return;
  }
  programsCache = data || [];
  renderProgramsTable();
}

function renderProgramsTable() {
  const tbody = document.getElementById("programsBody");
  if (!programsCache.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">등록된 프로그램이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = programsCache
    .map(
      (p) => `<tr>
        <td>${p.name}</td>
        <td>${p.category ?? "-"}</td>
        <td>${p.edu_date ?? "-"}</td>
        <td>${p.is_required ? "필수" : "선택"}</td>
        <td class="text-end">${p.required_hours}시간</td>
        <td>${p.has_exam ? "실시" : "미실시"}</td>
        <td>${p.retake_allowed ? "허용" : "1회"}</td>
        <td>${p.manager_name ?? "-"}</td>
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
  form.elements["category"].value = p.category ?? "";
  form.elements["edu_date"].value = p.edu_date ?? "";
  form.elements["is_required"].value = String(p.is_required);
  form.elements["required_hours"].value = p.required_hours ?? 0;
  form.elements["has_exam"].value = String(p.has_exam);
  form.elements["retake_allowed"].value = String(p.retake_allowed);
  form.elements["completion_criteria"].value = p.completion_criteria ?? "";
  form.elements["manager_name"].value = p.manager_name ?? "";
  form.elements["memo"].value = p.memo ?? "";
  new bootstrap.Modal(document.getElementById("programModal")).show();
}

async function saveProgram() {
  const form = document.getElementById("programForm");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  const id = payload.id;
  delete payload.id;

  payload.is_required = payload.is_required === "true";
  payload.has_exam = payload.has_exam === "true";
  payload.retake_allowed = payload.retake_allowed === "true";
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
