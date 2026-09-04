// =========================================================
// 관리자 화면 공통 레이아웃 (상단 헤더 + 좌측 사이드바)
// 각 admin 페이지의 body 안에
//   <div id="layoutHeader"></div>
//   <div class="app-layout">
//     <div id="layoutSidebar"></div>
//     <div class="main-content"> ... 페이지별 내용 ... </div>
//   </div>
// 형태로 넣고, renderLayout("dashboard") 처럼 현재 메뉴 key를 넘겨 호출합니다.
// =========================================================

function renderLayout(activeKey, adminName) {
  const header = document.getElementById("layoutHeader");
  const sidebar = document.getElementById("layoutSidebar");

  if (header) {
    header.outerHTML = `
    <div class="site-header">
      <div>
        <p class="title-main">2026 글로벌 인재 취업 선도대학</p>
        <p class="title-sub">학생 통합관리 시스템</p>
      </div>
      <div class="header-actions d-flex align-items-center gap-3">
        <span style="font-size:13px;">${adminName ? adminName + " 님" : ""}</span>
        <button id="logoutBtn">로그아웃</button>
      </div>
    </div>`;
  }

  const menu = [
    { key: "dashboard", label: "Dashboard", href: "dashboard.html", section: null },
    { key: "students", label: "전체 학생", href: "students.html", section: "학생관리" },
    { key: "programs", label: "교육 프로그램", href: "programs.html", section: "교육관리" },
    { key: "exams", label: "시험 관리", href: "exams.html", section: "학습평가" },
    { key: "results", label: "시험 결과 / 미응시자", href: "results.html", section: "학습평가" },
  ];

  if (sidebar) {
    let html = "";
    let lastSection = "__init__";
    menu.forEach((m) => {
      if (m.section !== lastSection) {
        html += `<div class="nav-section-title">${m.section ?? "전체 현황"}</div>`;
        lastSection = m.section;
      }
      html += `<a class="nav-link ${activeKey === m.key ? "active" : ""}" href="${m.href}">${m.label}</a>`;
    });
    sidebar.outerHTML = `<div class="sidebar">${html}</div>`;
  }

  bindLogoutButton();
}
