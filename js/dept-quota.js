// =========================================================
// admin/dept-quota.html 전용 스크립트
// "전체 관리자"만 접근하는 페이지입니다 (담당 학과가 있는 계정은
// layout.js에서 메뉴 자체가 안 보이지만, 직접 URL로 들어올 경우를
// 대비해 아래에서도 한 번 더 막습니다).
// =========================================================

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;

  if (auth.admin.department) {
    alert("학과별 인원 설정은 전체 관리자만 접근할 수 있습니다.");
    window.location.href = "dashboard.html";
    return;
  }

  renderLayout("dept-quota", auth.admin.name, auth.admin.department);
  await loadQuotaData();
})();

async function loadQuotaData() {
  const [{ data: students }, { data: evaluations }, { data: quotas }] = await Promise.all([
    fetchAllRows("students", "department"),
    fetchAllRows("student_evaluations", "student_id, grade, students(department)"),
    fetchAllRows("department_quotas", "*"),
  ]);

  const depts = Array.from(new Set((students || []).map((s) => s.department).filter(Boolean))).sort();

  const gradedCountByDept = {};
  (evaluations || []).forEach((ev) => {
    if (!ev.grade) return; // 등급이 없으면(기준 미달) 정원에 포함하지 않음
    const dept = ev.students?.department;
    if (!dept) return;
    gradedCountByDept[dept] = (gradedCountByDept[dept] || 0) + 1;
  });

  const quotaByDept = {};
  (quotas || []).forEach((q) => (quotaByDept[q.department] = q.quota));

  const tbody = document.getElementById("quotaBody");
  if (!depts.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">등록된 학과가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = depts
    .map((d) => {
      const current = gradedCountByDept[d] || 0;
      const quota = quotaByDept[d] ?? 0;
      const over = quota > 0 && current > quota;
      return `<tr>
        <td>${d}</td>
        <td class="text-end">
          <span style="font-weight:700; ${over ? "color:var(--danger);" : ""}">${current}명</span>
        </td>
        <td><input type="number" min="0" class="form-control form-control-sm quota-input" data-dept="${d}" value="${quota}"></td>
        <td><button class="btn btn-outline-navy btn-sm" onclick="saveQuota('${d}')">저장</button></td>
      </tr>`;
    })
    .join("");
}

async function saveQuota(department) {
  const input = document.querySelector(`.quota-input[data-dept="${department}"]`);
  const quota = Number(input.value || 0);

  const { error } = await supabaseClient.from("department_quotas").upsert({ department, quota }, { onConflict: "department" });
  if (error) {
    alert("저장 실패: " + error.message);
    return;
  }
  await loadQuotaData();
}
