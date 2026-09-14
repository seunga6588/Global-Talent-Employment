// =========================================================
// 인증 관련 공통 로직
// - 로그인 / 로그아웃
// - 관리자 권한 확인 (admin 페이지 접근 가드)
// =========================================================

// 로그인 처리 (login.html 에서 사용)
async function handleLogin(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    return { success: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 로그인한 사용자가 admins 테이블에 등록되어 있는지 확인
  const { data: adminRow, error: adminErr } = await supabaseClient
    .from("admins")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (adminErr || !adminRow) {
    await supabaseClient.auth.signOut();
    return { success: false, message: "관리자 권한이 없는 계정입니다. 담당자에게 문의하세요." };
  }

  return { success: true };
}

// 로그아웃
async function handleLogout() {
  await supabaseClient.auth.signOut();
  window.location.href = "../login.html";
}

// -----------------------------------------------------------
// admin/ 폴더의 모든 페이지 상단에서 호출해야 하는 접근 가드 함수.
// 로그인하지 않았거나 관리자 권한이 없으면 login.html 로 돌려보냅니다.
// -----------------------------------------------------------
async function requireAdmin() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "../login.html";
    return null;
  }

  const { data: adminRow } = await supabaseClient
    .from("admins")
    .select("id, name, department")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!adminRow) {
    await supabaseClient.auth.signOut();
    window.location.href = "../login.html";
    return null;
  }

  return { user: session.user, admin: adminRow };
}

// 사이드바에 로그아웃 버튼 이벤트를 연결하는 헬퍼
function bindLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (btn) btn.addEventListener("click", handleLogout);
}
