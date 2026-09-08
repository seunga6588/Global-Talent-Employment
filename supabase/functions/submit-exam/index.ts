// =========================================================
// submit-exam Edge Function
// 학생이 제출한 답안을 서버 측에서 채점합니다.
// 정답 데이터(exam_questions.correct_index)는 이 함수(서버) 안에서만 다뤄지고
// 학생 브라우저로는 절대 전송되지 않습니다.
// =========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // answers: [{ question_id, selected_index }, ...]
    const { exam_id, student_id, answers } = await req.json();
    if (!exam_id || !student_id || !Array.isArray(answers)) {
      return new Response(JSON.stringify({ error: "필수 값이 누락되었습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 시험 및 재응시 허용여부, 학생 정보 조회
    const [{ data: exam, error: examErr }, { data: student, error: stuErr }] = await Promise.all([
      supabase.from("exams").select("id, title, program_id, retake_allowed").eq("id", exam_id).maybeSingle(),
      supabase.from("students").select("id, student_no").eq("id", student_id).maybeSingle(),
    ]);
    if (examErr) throw examErr;
    if (stuErr) throw stuErr;
    if (!exam || !student) {
      return new Response(JSON.stringify({ error: "시험 또는 학생 정보를 찾을 수 없습니다." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const retakeAllowed = exam.retake_allowed ?? false;
    if (!retakeAllowed) {
      const { data: prevAttempt } = await supabase
        .from("exam_attempts")
        .select("id")
        .eq("exam_id", exam_id)
        .eq("student_id", student_id)
        .maybeSingle();
      if (prevAttempt) {
        return new Response(
          JSON.stringify({ error: "이미 학습평가를 완료하였습니다.", already_submitted: true }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 정답이 포함된 문제 목록 조회 (서버 내부에서만 사용)
    const { data: questions, error: qErr } = await supabase
      .from("exam_questions")
      .select("id, correct_index, score")
      .eq("exam_id", exam_id);
    if (qErr) throw qErr;

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    let correctCount = 0;
    let totalScore = 0;
    const answerRows: any[] = [];

    for (const a of answers) {
      const q = questionMap.get(a.question_id);
      if (!q) continue;
      const isCorrect = q.correct_index === a.selected_index;
      if (isCorrect) {
        correctCount += 1;
        totalScore += Number(q.score) || 0;
      }
      answerRows.push({
        question_id: a.question_id,
        selected_index: a.selected_index,
        is_correct: isCorrect,
      });
    }

    // 시험 응시 결과(exam_attempts) 저장
    const { data: attempt, error: attemptErr } = await supabase
      .from("exam_attempts")
      .insert({
        student_id,
        student_no: student.student_no,
        exam_id,
        program_id: exam.program_id,
        exam_title: exam.title,
        correct_count: correctCount,
        total_count: questions.length,
        score: totalScore,
      })
      .select()
      .single();
    if (attemptErr) throw attemptErr;

    // 문항별 답안(exam_answers) 저장
    if (answerRows.length > 0) {
      const rowsWithAttempt = answerRows.map((r) => ({ ...r, attempt_id: attempt.id }));
      const { error: ansErr } = await supabase.from("exam_answers").insert(rowsWithAttempt);
      if (ansErr) throw ansErr;
    }

    return new Response(
      JSON.stringify({
        success: true,
        correct_count: correctCount,
        total_count: questions.length,
        score: totalScore,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
