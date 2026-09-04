// =========================================================
// student/exam.html 전용 스크립트
// 모든 개인정보/정답 관련 처리는 Edge Function(lookup-student, get-exam, submit-exam)을
// 통해서만 이루어지며, 이 파일(브라우저에 노출되는 코드)에는 정답이 절대 담기지 않습니다.
// =========================================================

let verifiedStudent = null; // { student_id, student_no, masked_name }
let currentExam = null;     // { id, title, questions }
let selectedAnswers = {};   // { question_id: selected_index }

document.getElementById("lookupBtn").addEventListener("click", lookupStudent);
document.getElementById("confirmYesBtn").addEventListener("click", onConfirmYes);
document.getElementById("confirmNoBtn").addEventListener("click", onConfirmNo);
document.getElementById("submitExamBtn").addEventListener("click", submitExam);

function showStep(stepId) {
  ["stepStudentNo", "stepConfirm", "stepExamList", "stepExam", "stepResult"].forEach((id) => {
    document.getElementById(id).style.display = id === stepId ? "block" : "none";
  });
}

function showMessage(msg) {
  document.getElementById("messageBox").textContent = msg ?? "";
}

async function lookupStudent() {
  showMessage("");
  const errBox = document.getElementById("lookupError");
  errBox.style.display = "none";

  const studentNo = document.getElementById("studentNoInput").value.trim();
  if (!studentNo) return;

  const result = await callEdgeFunction("lookup-student", { student_no: studentNo });

  if (!result.found) {
    errBox.textContent = result.message || "일치하는 학번이 없습니다. 다시 확인해주세요.";
    errBox.style.display = "block";
    return;
  }

  verifiedStudent = result;
  document.getElementById("confirmText").textContent = `${result.masked_name} 학생이 맞습니까?`;
  showStep("stepConfirm");
}

function onConfirmNo() {
  verifiedStudent = null;
  document.getElementById("studentNoInput").value = "";
  showStep("stepStudentNo");
}

async function onConfirmYes() {
  // 응시 가능한(시작되었고 종료되지 않은) 시험 목록을 조회합니다.
  const { data: exams } = await supabaseClient
    .from("exams")
    .select("id, title, programs(name)")
    .eq("is_started", true)
    .eq("is_ended", false);

  const area = document.getElementById("examListArea");
  if (!exams || !exams.length) {
    area.innerHTML = `<p class="text-muted" style="font-size:14px;">현재 응시 가능한 학습평가가 없습니다.</p>`;
  } else {
    area.innerHTML = exams
      .map(
        (e) => `<button class="btn btn-outline-navy w-100 mb-2 text-start" onclick="startExam('${e.id}')">
          ${e.title} <span class="text-muted" style="font-size:12px;">(${e.programs?.name ?? ""})</span>
        </button>`
      )
      .join("");
  }
  showStep("stepExamList");
}

async function startExam(examId) {
  showMessage("");
  const result = await callEdgeFunction("get-exam", { exam_id: examId, student_id: verifiedStudent.student_id });

  if (result.error) {
    showMessage(result.error);
    return;
  }
  if (result.already_submitted) {
    document.getElementById("resultText").textContent = `${result.message} (점수: ${result.score}점)`;
    showStep("stepResult");
    return;
  }

  currentExam = { id: result.exam.id, title: result.exam.title, questions: result.questions };
  selectedAnswers = {};
  renderExam();
  showStep("stepExam");
}

function renderExam() {
  document.getElementById("examTitleText").textContent = currentExam.title;
  document.getElementById("examProgressText").textContent = `총 ${currentExam.questions.length}문제`;

  const area = document.getElementById("questionArea");
  area.innerHTML = currentExam.questions
    .map(
      (q, idx) => `
      <div class="mb-3 pb-3" style="border-bottom:1px solid #eee;">
        <p style="font-weight:700;">${idx + 1}. ${q.question}</p>
        ${q.choices
          .map(
            (choice, cIdx) => `
          <div class="form-check">
            <input class="form-check-input" type="radio" name="q_${q.id}" id="q_${q.id}_${cIdx}" onchange="selectAnswer('${q.id}', ${cIdx})">
            <label class="form-check-label" for="q_${q.id}_${cIdx}">${choice}</label>
          </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
}

function selectAnswer(questionId, choiceIndex) {
  selectedAnswers[questionId] = choiceIndex;
}

async function submitExam() {
  showMessage("");
  const unanswered = currentExam.questions.filter((q) => selectedAnswers[q.id] === undefined);
  if (unanswered.length > 0) {
    showMessage(`아직 답하지 않은 문제가 ${unanswered.length}개 있습니다.`);
    return;
  }

  const answers = Object.entries(selectedAnswers).map(([question_id, selected_index]) => ({ question_id, selected_index }));

  const result = await callEdgeFunction("submit-exam", {
    exam_id: currentExam.id,
    student_id: verifiedStudent.student_id,
    answers,
  });

  if (result.error) {
    showMessage(result.error);
    return;
  }

  document.getElementById("resultText").textContent = `제출이 완료되었습니다. (${result.correct_count} / ${result.total_count}문제 정답, ${result.score}점)`;
  showStep("stepResult");
}
