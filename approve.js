const loginCard = document.getElementById("loginCard");
const dashboardCard = document.getElementById("dashboardCard");
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginResult = document.getElementById("loginResult");
const dashboardResult = document.getElementById("dashboardResult");
const welcomeMessage = document.getElementById("welcomeMessage");
const requestList = document.getElementById("requestList");
const logoutBtn = document.getElementById("logoutBtn");

function showMessage(box, message, isError) {
  box.textContent = message;
  box.classList.remove("hidden", "success", "error");
  box.classList.add(isError ? "error" : "success");
}

function hideMessage(box) {
  box.classList.add("hidden");
}

function getSession() {
  const token = sessionStorage.getItem("approverToken");
  const fullName = sessionStorage.getItem("approverName");
  return token ? { token, fullName } : null;
}

function setSession(token, fullName) {
  sessionStorage.setItem("approverToken", token);
  sessionStorage.setItem("approverName", fullName);
}

function clearSession() {
  sessionStorage.removeItem("approverToken");
  sessionStorage.removeItem("approverName");
}

async function callBackend(payload) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function showDashboard(fullName) {
  loginCard.classList.add("hidden");
  dashboardCard.classList.remove("hidden");
  welcomeMessage.textContent = `Signed in as ${fullName}`;
  loadPendingRequests();
}

function showLogin() {
  dashboardCard.classList.add("hidden");
  loginCard.classList.remove("hidden");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessage(loginResult);

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("PASTE_YOUR")) {
    showMessage(loginResult, "Setup incomplete: add your Apps Script Web App URL in config.js", true);
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  try {
    const data = await callBackend({
      action: "login",
      username: loginForm.username.value.trim(),
      password: loginForm.password.value,
    });

    if (data.status === "ok") {
      setSession(data.token, data.fullName);
      loginForm.reset();
      showDashboard(data.fullName);
    } else {
      showMessage(loginResult, data.message || "Login failed.", true);
    }
  } catch (err) {
    showMessage(loginResult, "Could not reach the server. Please try again later.", true);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log In";
  }
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  showLogin();
});

async function loadPendingRequests() {
  const session = getSession();
  if (!session) {
    showLogin();
    return;
  }

  requestList.innerHTML = '<p class="empty-state">Loading...</p>';
  hideMessage(dashboardResult);

  try {
    const data = await callBackend({ action: "listPending", token: session.token });

    if (data.status !== "ok") {
      clearSession();
      showLogin();
      showMessage(loginResult, data.message || "Session expired. Please log in again.", true);
      return;
    }

    renderRequests(data.requests);
  } catch (err) {
    requestList.innerHTML = "";
    showMessage(dashboardResult, "Could not reach the server. Please try again later.", true);
  }
}

function renderRequests(requests) {
  requestList.innerHTML = "";

  if (!requests.length) {
    requestList.innerHTML = '<p class="empty-state">No pending requests right now.</p>';
    return;
  }

  requests.forEach((req) => {
    const item = document.createElement("div");
    item.className = "request-item";
    item.innerHTML = `
      <div class="request-title">${escapeHtml(req.name)} — ${escapeHtml(req.leaveType)}</div>
      <div class="request-meta">${escapeHtml(req.startDate)} to ${escapeHtml(req.endDate)} (${escapeHtml(String(req.daysRequested))} day(s))</div>
      <div class="request-meta">${escapeHtml(req.email || "")}</div>
      <div class="request-reason">${escapeHtml(req.reason || "")}</div>
      <div class="request-actions">
        <button type="button" class="approve-btn">Approve</button>
        <button type="button" class="reject-btn">Reject</button>
      </div>
    `;

    item.querySelector(".approve-btn").addEventListener("click", () => decide(req.requestId, "approve", item));
    item.querySelector(".reject-btn").addEventListener("click", () => decide(req.requestId, "reject", item));

    requestList.appendChild(item);
  });
}

async function decide(requestId, decision, item) {
  const session = getSession();
  if (!session) {
    showLogin();
    return;
  }

  const buttons = item.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));

  try {
    const data = await callBackend({
      action: "decide",
      token: session.token,
      requestId,
      decision,
    });

    if (data.status === "ok") {
      item.remove();
      if (!requestList.children.length) {
        requestList.innerHTML = '<p class="empty-state">No pending requests right now.</p>';
      }
    } else {
      showMessage(dashboardResult, data.message || "Could not process this request.", true);
      buttons.forEach((b) => (b.disabled = false));
    }
  } catch (err) {
    showMessage(dashboardResult, "Could not reach the server. Please try again later.", true);
    buttons.forEach((b) => (b.disabled = false));
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

const existingSession = getSession();
if (existingSession) {
  showDashboard(existingSession.fullName);
}
