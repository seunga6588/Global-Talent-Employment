// =========================================================
// lookup-student Edge Function
// 학생이 입력한 "학번"이 DB에 존재하는지 확인하고,
// 존재하면 "이름 일부(마스킹)"만 돌려줍니다.
// RLS를 우회하는 SERVICE_ROLE_KEY를 서버(Edge Function) 안에서만 사용하므로
// 학생용 브라우저 JS 코드에는 절대 노출되지 않습니다.
// =========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 이름을 "홍*동" 형태로 마스킹하는 함수
function maskName(name: string): string {
  if (!name) return "";
  if (name.length <= 2) return name[0] + "*";
  const chars = name.split("");
  for (let i = 1; i < chars.length - 1; i++) chars[i] = "*";
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { student_no } = await req.json();
    if (!student_no) {
      return new Response(JSON.stringify({ error: "학번을 입력해주세요." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 서비스 역할 키로 클라이언트 생성 (RLS 우회, 서버에서만 사용)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: student, error } = await supabase
      .from("students")
      .select("id, student_no, name")
      .eq("student_no", student_no.trim())
      .maybeSingle();

    if (error) throw error;

    if (!student) {
      return new Response(
        JSON.stringify({ found: false, message: "일치하는 학번이 없습니다." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        found: true,
        student_id: student.id,
        student_no: student.student_no,
        masked_name: maskName(student.name),
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
