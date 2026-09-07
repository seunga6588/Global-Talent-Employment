// =========================================================
// admin/exams.html 전용 스크립트
// =========================================================

let examsCache = [];
let programsForSelect = [];
let currentExamId = null;
let questionsCache = [];

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("exams", auth.admin.name);

  await loadProgramOptions();
  await loadExams();

  document.getElementById("saveExamBtn").addEventListener("click", saveExam);
  document.getElementById("saveQuestionBtn").addEventListener("click", saveQuestion);
})();

async function loadProgramOptions() {
  const { data } = await supabaseClient.from("programs").select("id, name").eq("has_exam", true).order("name");
  programsForSelect = data || [];
  const sel = document.getElementById("programSelect");
  sel.innerHTML = programsForSelect.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
}

async function loadExams() {
  const { data, error } = await supabaseClient
    .from("exams")
    .select("*, programs(name), exam_questions(id)")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("examsBody").innerHTML = `<tr><td colspan="5" class="text-danger text-center py-3">${error.message}</td></tr>`;
    return;
  }
  examsCache = data || [];
  renderExamsTable();
}

function renderExamsTable() {
  const tbody = document.getElementById("examsBody");
  if (!examsCache.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">등록된 시험이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = examsCache
    .map((e) => {
      const qCount = e.exam_questions?.length ?? 0;
      const statusText = e.is_ended ? "종료" : e.is_started ? "진행중" : "대기";
      return `<tr>
        <td><a class="row-link" href="#" onclick="manageQuestions('${e.id}'); return false;">${e.title}</a></td>
        <td>${e.programs?.name ?? "-"}</td>
        <td class="text-end">${qCount}문제</td>
        <td><span class="badge-status badge-${e.is_ended ? "미이수" : e.is_started ? "진행중" : "이수"}">${statusText}</span></td>
        <td class="text-nowrap">
          <button class="btn btn-outline-navy btn-sm" onclick="manageQuestions('${e.id}')">문제 관리</button>
          ${!e.is_started ? `<button class="btn btn-pink btn-sm" onclick="toggleExam('${e.id}', {is_started:true})">시험 시작</button>` : ""}
          ${e.is_started && !e.is_ended ? `<button class="btn btn-outline-secondary btn-sm" onclick="toggleExam('${e.id}', {is_ended:true})">시험 종료</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

async function toggleExam(id, patch) {
  const { error } = await supabaseClient.from("exams").update(patch).eq("id", id);
  if (error) { alert("변경 실패: " + error.message); return; }
  await loadExams();
}

async function saveExam() {
  const form = document.getElementById("examForm");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  const { error } = await supabaseClient.from("exams").insert(payload);
  if (error) { alert("저장 실패: " + error.message); return; }

  bootstrap.Modal.getInstance(document.getElementById("examModal")).hide();
  form.reset();
  await loadExams();
}

// -----------------------------------------------------------
// 문제 관리
// -----------------------------------------------------------
async function manageQuestions(examId) {
  currentExamId = examId;
  const exam = examsCache.find((e) => e.id === examId);
  document.getElementById("questionPanel").style.display = "block";
  document.getElementById("questionPanelTitle").textContent = `문제 관리 - ${exam?.title ?? ""}`;
  document.getElementById("questionPanel").scrollIntoView({ behavior: "smooth" });
  await loadQuestions();
}

async function loadQuestions() {
  const { data, error } = await supabaseClient
    .from("exam_questions")
    .select("*")
    .eq("exam_id", currentExamId)
    .order("seq", { ascending: true });
  if (error) { alert(error.message); return; }
  questionsCache = data || [];
  renderQuestionsTable();
}

function renderQuestionsTable() {
  const tbody = document.getElementById("questionsBody");
  if (!questionsCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">등록된 문제가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = questionsCache
    .map(
      (q, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${q.question}</td>
        <td>${q.choices.join(" / ")}</td>
        <td>${q.choices[q.correct_index] ?? ""}</td>
        <td class="text-end">${q.score}</td>
        <td class="text-nowrap">
          <button class="btn btn-outline-navy btn-sm" onclick="openEditQuestion('${q.id}')">수정</button>
          <button class="btn btn-outline-secondary btn-sm" onclick="deleteQuestion('${q.id}')">삭제</button>
        </td>
      </tr>`
    )
    .join("");
}

function openAddQuestion() {
  document.getElementById("questionModalTitle").textContent = "문제 추가";
  document.getElementById("questionForm").reset();
  document.getElementById("questionForm").elements["id"].value = "";
}

function openEditQuestion(id) {
  const q = questionsCache.find((x) => x.id === id);
  if (!q) return;
  document.getElementById("questionModalTitle").textContent = "문제 수정";
  const form = document.getElementById("questionForm");
  form.elements["id"].value = q.id;
  form.elements["question"].value = q.question;
  form.elements["choice1"].value = q.choices[0] ?? "";
  form.elements["choice2"].value = q.choices[1] ?? "";
  form.elements["choice3"].value = q.choices[2] ?? "";
  form.elements["choice4"].value = q.choices[3] ?? "";
  form.elements["choice5"].value = q.choices[4] ?? "";
  form.elements["correct"].value = q.correct_index + 1;
  form.elements["score"].value = q.score;
  new bootstrap.Modal(document.getElementById("questionModal")).show();
}

async function saveQuestion() {
  const form = document.getElementById("questionForm");
  const fd = new FormData(form);
  const raw = Object.fromEntries(fd.entries());

  const choices = [raw.choice1, raw.choice2, raw.choice3, raw.choice4, raw.choice5].filter((c) => c && c.trim() !== "");
  const correctIndex = Number(raw.correct) - 1;

  if (choices.length < 2) { alert("보기는 최소 2개 이상 입력해야 합니다."); return; }
  if (correctIndex < 0 || correctIndex >= choices.length) { alert("정답 번호가 보기 범위를 벗어났습니다."); return; }

  const payload = {
    exam_id: currentExamId,
    question: raw.question,
    choices,
    correct_index: correctIndex,
    score: Number(raw.score || 10),
    seq: raw.id ? undefined : questionsCache.length + 1,
  };

  let error;
  if (raw.id) {
    delete payload.seq;
    ({ error } = await supabaseClient.from("exam_questions").update(payload).eq("id", raw.id));
  } else {
    ({ error } = await supabaseClient.from("exam_questions").insert(payload));
  }

  if (error) { alert("저장 실패: " + error.message); return; }

  bootstrap.Modal.getInstance(document.getElementById("questionModal")).hide();
  await loadQuestions();

  // 시험의 question_count 갱신
  await supabaseClient.from("exams").update({ question_count: questionsCache.length }).eq("id", currentExamId);
  await loadExams();
}

async function deleteQuestion(id) {
  if (!confirm("이 문제를 삭제하시겠습니까?")) return;
  const { error } = await supabaseClient.from("exam_questions").delete().eq("id", id);
  if (error) { alert("삭제 실패: " + error.message); return; }
  await loadQuestions();
  await supabaseClient.from("exams").update({ question_count: questionsCache.length }).eq("id", currentExamId);
  await loadExams();
}
