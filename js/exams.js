// =========================================================
// admin/exams.html 전용 스크립트
// 학습평가는 이제 특정 프로그램이 아니라 "전체 프로그램 이수 후" 응시하는
// 종합 시험 1개(또는 여러 회차)로 관리합니다.
// =========================================================

let examsCache = [];
let currentExamId = null;
let questionsCache = [];

// 2025년 사업 수료 시험지에서 추출한 기본 20문항 (문제/보기/정답 포함)
// 정답은 choices 배열의 인덱스(0부터 시작)입니다.
const SAMPLE_QUESTIONS = [
  { question: "이력서는 무엇을 쓰는 문서인가요?", choices: ["친구에게 보내는 편지", "회사에 나를 소개하는 글", "시험 문제", "광고 문구"], correct_index: 1 },
  { question: "이력서에 쓰면 좋은 내용은 무엇인가요?", choices: ["키와 몸무게", "가족 직업", "지원한 일과 관련된 경험", "좋아하는 음식"], correct_index: 2 },
  { question: "자기소개서에서 가장 중요한 것은 무엇인가요?", choices: ["글의 길이", "회사와 일에 맞는 내용", "어려운 단어 사용", "사진 첨부"], correct_index: 1 },
  { question: "이력서와 자기소개서에 쓰면 안 되는 것은?", choices: ["사실과 다른 내용", "자격증", "실습 경험", "아르바이트 경험"], correct_index: 0 },
  { question: "자기소개서에서 경험을 쓸 때 좋은 방법은?", choices: ["그냥 느낌만 말한다.", "친구 이야기로 대신한다.", "내가 한 일을 간단하게 설명한다.", "내용을 반복해서 쓴다."], correct_index: 2 },
  { question: "자기소개서를 쓸 때 가장 좋은 태도는?", choices: ["거짓말을 한다.", "복사해서 그대로 쓴다.", "솔직하고 간단하게 쓴다.", "너무 길게 쓴다."], correct_index: 2 },
  { question: "면접에 갈 때 가장 중요한 것은?", choices: ["비싼 옷", "단정한 옷과 예의", "유행하는 머리", "친구와 동행"], correct_index: 1 },
  { question: "면접 질문을 들을 때 가장 좋은 행동은?", choices: ["질문을 끝까지 듣는다", "바로 말을 끊는다", "웃기만 한다.", "다른 생각을 한다."], correct_index: 0 },
  { question: "면접에서 질문에 답할 때 좋은 방법은?", choices: ["길게 아무 말이나 한다.", "질문과 관계없는 이야기", "질문에 맞게 짧게 말한다.", "말을 하지 않는다."], correct_index: 2 },
  { question: "면접 중 모르는 질문이 나오면 어떻게 해야 하나요?", choices: ["아무 대답이나 한다.", "화를 낸다.", "솔직하게 모른다고 말한다.", "대답을 피한다."], correct_index: 2 },
  { question: "면접에서 좋은 태도는 무엇인가요?", choices: ["고개를 숙이고 말하지 않는다.", "눈을 보고 천천히 말한다.", "스마트폰을 본다.", "의자에 기대어 앉는다"], correct_index: 1 },
  { question: "중소기업에서 일하면 좋은 점은?", choices: ["할 일이 없다.", "다양한 일을 배울 수 있다.", "출근을 안 해도 된다.", "책임이 없다."], correct_index: 1 },
  { question: "중소기업에서 중요한 직원 모습은?", choices: ["시키는 일만 한다.", "배우려는 마음이 있다.", "자주 지각한다.", "혼자만 생각한다."], correct_index: 1 },
  { question: "회사 선택할 때 중요한 것은?", choices: ["회사 이름", "회사 위치", "급여만 본다.", "근무 환경과 배울 수 있는 것"], correct_index: 3 },
  { question: "근로기준법은 왜 필요한가요?", choices: ["회사만 보호하려고", "근로자를 보호하려고", "시험을 어렵게 하려고", "벌금을 주려고"], correct_index: 1 },
  { question: "하루에 일하는 시간은 보통 몇 시간인가요?", choices: ["4시간", "6시간", "8시간", "12시간"], correct_index: 2 },
  { question: "일할 때 가장 중요한 것은?", choices: ["빠른 속도", "안전", "재미", "혼자 일하기"], correct_index: 1 },
  { question: "안전한 일을 위해 해야 할 행동은?", choices: ["안전 규칙 지키기", "보호장비 안 쓰기", "위험한 곳에 혼자 가기", "교육을 안 듣기"], correct_index: 0 },
  { question: "근로 기준·안전 교육을 받는 이유는?", choices: ["시험 때문에", "회사가 시켜서", "내 권리와 안전을 지키기 위해", "출석만 하려고"], correct_index: 2 },
  { question: "외국인 유학생에게 맞춤형 중소기업 일자리를 One-Stop으로 지원하고, 중소기업에겐 우수한 글로벌 인재를 유치할 수 있도록 도와주는 외국인 유학생 전용 취업 매칭 플랫폼은 무엇인가?", choices: ["K-Work 플랫폼", "카카오톡", "네이버", "구글"], correct_index: 0 },
];

(async function init() {
  const auth = await requireAdmin();
  if (!auth) return;
  renderLayout("exams", auth.admin.name);

  await loadExams();

  document.getElementById("saveExamBtn").addEventListener("click", saveExam);
  document.getElementById("saveQuestionBtn").addEventListener("click", saveQuestion);
  document.getElementById("loadSampleQuestionsBtn").addEventListener("click", loadSampleQuestions);
})();

async function loadExams() {
  const { data, error } = await supabaseClient
    .from("exams")
    .select("*, exam_questions(id)")
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
        <td class="text-end">${qCount}문제</td>
        <td>${e.retake_allowed ? "허용" : "1회"}</td>
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
  payload.retake_allowed = payload.retake_allowed === "true";

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
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">등록된 문제가 없습니다. 위 "기본 시험지 20문항 불러오기" 버튼을 사용하거나 직접 추가하세요.</td></tr>`;
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

// 기본 시험지(20문항)를 현재 선택된 시험에 한번에 등록
async function loadSampleQuestions() {
  if (!currentExamId) {
    alert("먼저 시험 목록에서 '문제 관리'할 시험을 선택해주세요.");
    return;
  }
  if (questionsCache.length > 0) {
    if (!confirm("이미 등록된 문제가 있습니다. 기본 시험지 20문항을 추가로 등록할까요? (중복될 수 있습니다)")) return;
  } else {
    if (!confirm("기본 시험지 20문항을 이 시험에 등록하시겠습니까?")) return;
  }

  const startSeq = questionsCache.length;
  const payloads = SAMPLE_QUESTIONS.map((q, idx) => ({
    exam_id: currentExamId,
    seq: startSeq + idx + 1,
    question: q.question,
    choices: q.choices,
    correct_index: q.correct_index,
    score: 5, // 20문항 x 5점 = 100점
  }));

  const { error } = await supabaseClient.from("exam_questions").insert(payloads);
  if (error) { alert("등록 실패: " + error.message); return; }

  await loadQuestions();
  await supabaseClient.from("exams").update({ question_count: questionsCache.length }).eq("id", currentExamId);
  await loadExams();
  alert("기본 시험지 20문항이 등록되었습니다. (문항당 5점, 총 100점)");
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
