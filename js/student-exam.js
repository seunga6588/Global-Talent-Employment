// =========================================================
// student/exam.html 전용 스크립트
// -----------------------------------------------------------
// 학습평가는 "전체 교육 프로그램을 모두 이수한 학생"이 응시하는
// 종합 시험 1회입니다. 학생이 학번으로 본인 확인을 마치면
// 바로 이수 여부를 확인하고, 이수했다면 시험 문제를 보여줍니다.
// 정답/개인정보 관련 처리는 모두 Edge Function(lookup-student, get-exam,
// submit-exam)을 통해서만 이루어지며, 이 파일에는 정답이 담기지 않습니다.
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

// 본인 확인 후: 바로 전체 이수 여부 + 응시 가능한 시험을 확인합니다.
async function onConfirmYes() {
  showMessage("");
  const result = await callEdgeFunction("get-exam", { student_id: verifiedStudent.student_id });

  if (result.error) {
    showMessage(result.error);
    return;
  }

  // 1) 총 이수시간이 기준(120시간)에 미달한 경우
  if (!result.eligible) {
    document.getElementById("examListTitle").textContent = "학습평가 응시 불가";
    document.getElementById("examListArea").innerHTML = `
      <p style="font-size:14px;">${result.message}</p>
      <p style="font-size:14px; color:var(--navy); font-weight:700;">
        현재 이수시간: ${result.total_hours}시간 / ${result.required_total_hours}시간
      </p>`;
    showStep("stepExamList");
    return;
  }

  // 2) 전체 이수는 완료했지만 현재 진행 중인 시험이 없는 경우
  if (result.no_active_exam) {
    document.getElementById("examListTitle").textContent = "안내";
    document.getElementById("examListArea").innerHTML = `<p style="font-size:14px;">${result.message}</p>`;
    showStep("stepExamList");
    return;
  }

  // 3) 이미 응시를 완료한 경우
  if (result.already_submitted) {
    document.getElementById("resultText").textContent = `${result.message} (점수: ${result.score}점)`;
    showStep("stepResult");
    return;
  }

  // 4) 응시 가능 -> 바로 시험 화면으로 이동
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
