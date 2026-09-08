// =========================================================
// get-exam Edge Function
// -----------------------------------------------------------
// 학습평가는 더 이상 "프로그램별"이 아니라 "전체 프로그램을 모두 이수한 뒤
// 응시하는 종합 시험 1회" 방식입니다.
//
// 동작 순서:
// 1) student_id로 전체 프로그램 이수 여부를 확인합니다.
//    (모든 프로그램의 completed_hours >= required_hours 인지 체크)
// 2) 아직 다 이수하지 않았다면 eligible:false 와 함께 미이수 프로그램 목록을 돌려줍니다.
// 3) 다 이수했다면, 현재 시작되었고 종료되지 않은 시험을 찾아 문제(정답 제외)를 내려줍니다.
// 4) 이미 응시했고 재응시가 허용되지 않으면 already_submitted:true 를 돌려줍니다.
// =========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { student_id } = await req.json();
    if (!student_id) {
      return new Response(JSON.stringify({ error: "필수 값이 누락되었습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1) 전체 프로그램 이수 여부 확인
    const [{ data: programs, error: progErr }, { data: enrollments, error: enrollErr }] = await Promise.all([
      supabase.from("programs").select("id, name, required_hours"),
      supabase.from("enrollments").select("program_id, completed_hours").eq("student_id", student_id),
    ]);
    if (progErr) throw progErr;
    if (enrollErr) throw enrollErr;

    const hoursByProgram = new Map((enrollments ?? []).map((e) => [e.program_id, Number(e.completed_hours || 0)]));
    const incomplete = (programs ?? []).filter((p) => {
      const done = hoursByProgram.get(p.id) ?? 0;
      return done < Number(p.required_hours || 0);
    });

    if (incomplete.length > 0) {
      return new Response(
        JSON.stringify({
          eligible: false,
          message: "아직 모든 교육 프로그램을 이수하지 않아 학습평가에 응시할 수 없습니다.",
          incomplete_programs: incomplete.map((p) => p.name),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2) 현재 응시 가능한(시작+진행중) 시험 찾기
    const { data: exam, error: examErr } = await supabase
      .from("exams")
      .select("id, title, retake_allowed")
      .eq("is_started", true)
      .eq("is_ended", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (examErr) throw examErr;

    if (!exam) {
      return new Response(
        JSON.stringify({ eligible: true, no_active_exam: true, message: "현재 진행 중인 학습평가가 없습니다." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3) 이미 응시했는지 확인 (재응시 미허용 시)
    if (!exam.retake_allowed) {
      const { data: prevAttempt } = await supabase
        .from("exam_attempts")
        .select("id, score")
        .eq("exam_id", exam.id)
        .eq("student_id", student_id)
        .maybeSingle();

      if (prevAttempt) {
        return new Response(
          JSON.stringify({
            eligible: true,
            already_submitted: true,
            message: "이미 학습평가를 완료하였습니다.",
            score: prevAttempt.score,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 4) 정답을 제외한 문제 목록 조회
    const { data: questions, error: qErr } = await supabase
      .from("exam_questions")
      .select("id, seq, question, choices, score")
      .eq("exam_id", exam.id)
      .order("seq", { ascending: true });
    if (qErr) throw qErr;

    return new Response(
      JSON.stringify({
        eligible: true,
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
