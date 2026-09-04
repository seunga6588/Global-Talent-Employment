// =========================================================
// get-exam Edge Function
// 특정 학생에게 특정 시험 문제를 "정답 없이" 내려줍니다.
// 이미 응시(제출)한 시험이고 재응시가 허용되지 않은 프로그램이면
// already_submitted:true 를 반환하여 프론트에서 안내 메시지를 띄우게 합니다.
// =========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { exam_id, student_id } = await req.json();
    if (!exam_id || !student_id) {
      return new Response(JSON.stringify({ error: "필수 값이 누락되었습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 시험 정보 확인 (시작되었고 종료되지 않았는지)
    const { data: exam, error: examErr } = await supabase
      .from("exams")
      .select("id, title, program_id, is_started, is_ended, programs(retake_allowed)")
      .eq("id", exam_id)
      .maybeSingle();
    if (examErr) throw examErr;
    if (!exam || !exam.is_started || exam.is_ended) {
      return new Response(JSON.stringify({ error: "현재 응시할 수 없는 시험입니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 재응시 허용 여부 확인 (프로그램 설정 기준)
    const retakeAllowed = (exam as any).programs?.retake_allowed ?? false;

    if (!retakeAllowed) {
      const { data: prevAttempt } = await supabase
        .from("exam_attempts")
        .select("id, score")
        .eq("exam_id", exam_id)
        .eq("student_id", student_id)
        .maybeSingle();

      if (prevAttempt) {
        return new Response(
          JSON.stringify({
            already_submitted: true,
            message: "이미 학습평가를 완료하였습니다.",
            score: prevAttempt.score,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 정답을 제외한 문제 목록 조회
    const { data: questions, error: qErr } = await supabase
      .from("exam_questions")
      .select("id, seq, question, choices, score")
      .eq("exam_id", exam_id)
      .order("seq", { ascending: true });
    if (qErr) throw qErr;

    return new Response(
      JSON.stringify({
        already_submitted: false,
        exam: { id: exam.id, title: exam.title },
        questions,
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
