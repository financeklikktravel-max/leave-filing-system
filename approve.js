const loginCard = document.getElementById("loginCard");
const dashboardCard = document.getElementById("dashboardCard");
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginResult = document.getElementById("loginResult");
const dashboardResult = document.getElementById("dashboardResult");
const dashboardTitle = document.getElementById("dashboardTitle");
const welcomeMessage = document.getElementById("welcomeMessage");
const requestList = document.getElementById("requestList");
const logoutBtn = document.getElementById("logoutBtn");
const tabPending = document.getElementById("tabPending");
const tabHistory = document.getElementById("tabHistory");

let activeTab = "pending";

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

const approverSignatureCanvas = document.getElementById("approverSignatureCanvas");
const approverSigCtx = approverSignatureCanvas.getContext("2d");
const clearApproverSignatureBtn = document.getElementById("clearApproverSignatureBtn");
let isDrawingApproverSig = false;
let hasApproverSignature = false;

function sizeApproverSignatureCanvas() {
  const rect = approverSignatureCanvas.getBoundingClientRect();
  const saved = sessionStorage.getItem("approverSignature");
  approverSignatureCanvas.width = rect.width;
  approverSignatureCanvas.height = rect.height;
  approverSigCtx.fillStyle = "#ffffff";
  approverSigCtx.fillRect(0, 0, approverSignatureCanvas.width, approverSignatureCanvas.height);
  if (saved) {
    const img = new Image();
    img.onload = () => approverSigCtx.drawImage(img, 0, 0, approverSignatureCanvas.width, approverSignatureCanvas.height);
    img.src = saved;
    hasApproverSignature = true;
  }
}

window.addEventListener("resize", sizeApproverSignatureCanvas);

function getApproverSigPos(e) {
  const rect = approverSignatureCanvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}

function startApproverSig(e) {
  isDrawingApproverSig = true;
  hasApproverSignature = true;
  const pos = getApproverSigPos(e);
  approverSigCtx.beginPath();
  approverSigCtx.moveTo(pos.x, pos.y);
  e.preventDefault();
}

function drawApproverSig(e) {
  if (!isDrawingApproverSig) return;
  const pos = getApproverSigPos(e);
  approverSigCtx.strokeStyle = "#111111";
  approverSigCtx.lineWidth = 2;
  approverSigCtx.lineCap = "round";
  approverSigCtx.lineTo(pos.x, pos.y);
  approverSigCtx.stroke();
  e.preventDefault();
}

function stopApproverSig() {
  if (!isDrawingApproverSig) return;
  isDrawingApproverSig = false;
  sessionStorage.setItem("approverSignature", approverSignatureCanvas.toDataURL("image/png"));
}

approverSignatureCanvas.addEventListener("mousedown", startApproverSig);
approverSignatureCanvas.addEventListener("mousemove", drawApproverSig);
window.addEventListener("mouseup", stopApproverSig);
approverSignatureCanvas.addEventListener("touchstart", startApproverSig, { passive: false });
approverSignatureCanvas.addEventListener("touchmove", drawApproverSig, { passive: false });
approverSignatureCanvas.addEventListener("touchend", stopApproverSig);

clearApproverSignatureBtn.addEventListener("click", () => {
  approverSigCtx.fillStyle = "#ffffff";
  approverSigCtx.fillRect(0, 0, approverSignatureCanvas.width, approverSignatureCanvas.height);
  hasApproverSignature = false;
  sessionStorage.removeItem("approverSignature");
});

function showDashboard(fullName) {
  loginCard.classList.add("hidden");
  dashboardCard.classList.remove("hidden");
  welcomeMessage.textContent = `Signed in as ${fullName}`;
  sizeApproverSignatureCanvas();
  switchTab("pending");
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

function switchTab(tab) {
  activeTab = tab;
  tabPending.classList.toggle("active", tab === "pending");
  tabHistory.classList.toggle("active", tab === "history");
  dashboardTitle.textContent = tab === "pending" ? "Pending Leave Requests" : "Decided Leave Requests";
  hideMessage(dashboardResult);

  if (tab === "pending") {
    loadPendingRequests();
  } else {
    loadHistory();
  }
}

tabPending.addEventListener("click", () => switchTab("pending"));
tabHistory.addEventListener("click", () => switchTab("history"));

async function loadPendingRequests() {
  const session = getSession();
  if (!session) {
    showLogin();
    return;
  }

  requestList.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const data = await callBackend({ action: "listPending", token: session.token });

    if (data.status !== "ok") {
      clearSession();
      showLogin();
      showMessage(loginResult, data.message || "Session expired. Please log in again.", true);
      return;
    }

    renderPending(data.requests);
  } catch (err) {
    requestList.innerHTML = "";
    showMessage(dashboardResult, "Could not reach the server. Please try again later.", true);
  }
}

async function loadHistory() {
  const session = getSession();
  if (!session) {
    showLogin();
    return;
  }

  requestList.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const data = await callBackend({ action: "listDecided", token: session.token });

    if (data.status !== "ok") {
      clearSession();
      showLogin();
      showMessage(loginResult, data.message || "Session expired. Please log in again.", true);
      return;
    }

    renderHistory(data.requests);
  } catch (err) {
    requestList.innerHTML = "";
    showMessage(dashboardResult, "Could not reach the server. Please try again later.", true);
  }
}

function renderPending(requests) {
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

    item.querySelector(".approve-btn").addEventListener("click", () => decide(req, "approve", item));
    item.querySelector(".reject-btn").addEventListener("click", () => decide(req, "reject", item));

    requestList.appendChild(item);
  });
}

function renderHistory(requests) {
  requestList.innerHTML = "";

  if (!requests.length) {
    requestList.innerHTML = '<p class="empty-state">No decided requests yet.</p>';
    return;
  }

  requests.forEach((req) => {
    const isApproved = req.status === "Approved";
    const badgeClass = isApproved ? "approved" : "rejected";
    const badgeText = isApproved ? "Approved" : "Rejected";

    const item = document.createElement("div");
    item.className = "request-item";
    item.innerHTML = `
      <div class="request-title">${escapeHtml(req.name)} — ${escapeHtml(req.leaveType)}<span class="status-badge ${badgeClass}">${badgeText}</span></div>
      <div class="request-meta">${escapeHtml(req.startDate)} to ${escapeHtml(req.endDate)} (${escapeHtml(String(req.daysRequested))} day(s))</div>
      <div class="request-meta">${escapeHtml(req.email || "")}</div>
      <div class="request-reason">${escapeHtml(req.reason || "")}</div>
      <div class="request-meta">Decided by ${escapeHtml(req.approvedBy || "-")} on ${escapeHtml(String(req.decidedAt || "-"))}</div>
    `;

    requestList.appendChild(item);
  });
}

function formatDisplayDate(dateString) {
  const d = new Date(dateString + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function addDays(dateString, amount) {
  const d = new Date(dateString + "T00:00:00");
  d.setDate(d.getDate() + amount);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function setCheckbox(id, checked) {
  const el = document.getElementById(id);
  if (el) el.textContent = checked ? "✓" : "";
}

async function downloadApprovedLeaveFormPdf(pdfData) {
  document.getElementById("pdfName").textContent = pdfData.name;
  document.getElementById("pdfSubmitDate").textContent = pdfData.decidedAt;
  document.getElementById("pdfPosition").textContent = pdfData.position;
  document.getElementById("pdfBranch").textContent = pdfData.branch;
  document.getElementById("pdfStartDate").textContent = formatDisplayDate(pdfData.startDate);
  document.getElementById("pdfEndDate").textContent = formatDisplayDate(pdfData.endDate);
  document.getElementById("pdfDays").textContent = pdfData.daysRequested;
  document.getElementById("pdfBackToWork").textContent = formatDisplayDate(addDays(pdfData.endDate, 1));
  document.getElementById("pdfReason").textContent = pdfData.reason;

  setCheckbox("pdfCheckVacation", pdfData.leaveType === "Leave With Pay");
  setCheckbox("pdfCheckSick", pdfData.leaveType === "Sick Leave");
  setCheckbox("pdfCheckPaternity", false);
  setCheckbox("pdfCheckMaternity", false);
  document.getElementById("pdfOthersSpecify").textContent = pdfData.leaveType === "Leave W/O Pay" ? "Leave Without Pay" : "";

  setCheckbox("pdfWithPayBox", pdfData.leaveType !== "Leave W/O Pay");
  setCheckbox("pdfWithoutPayBox", pdfData.leaveType === "Leave W/O Pay");

  document.getElementById("pdfSignatureImg").src = pdfData.employeeSignature || "";
  document.getElementById("pdfApproverSignatureImg").src = sessionStorage.getItem("approverSignature") || "";

  document.getElementById("pdfApprovalDate").textContent = "Date  " + pdfData.decidedAt;
  const balanceLabel = pdfData.isUnlimited ? "days used" : "days";
  document.getElementById("pdfBalanceToDate").textContent = `Balance to date  ${pdfData.balanceBefore} ${balanceLabel}`;
  document.getElementById("pdfAvailmentToDate").textContent = `Availment to date  ${pdfData.daysRequested} ${balanceLabel}`;
  document.getElementById("pdfNewBalance").textContent = `NEW Balance  ${pdfData.balanceAfter} ${balanceLabel}`;

  const template = document.getElementById("leaveFormTemplate");
  const canvas = await html2canvas(template, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);

  const fileSafeName = pdfData.name.replace(/[^a-z0-9]+/gi, "-");
  pdf.save(`Leave-Form-${fileSafeName}-${pdfData.startDate}-Approved.pdf`);
}

async function decide(req, decision, item) {
  const session = getSession();
  if (!session) {
    showLogin();
    return;
  }

  if (decision === "approve" && !hasApproverSignature) {
    showMessage(dashboardResult, "Please sign in the signature box above before approving.", true);
    return;
  }

  const buttons = item.querySelectorAll("button");
  buttons.forEach((b) => b.classList.add("busy"));

  try {
    const data = await callBackend({
      action: "decide",
      token: session.token,
      requestId: req.requestId,
      decision,
    });

    if (data.status === "ok") {
      const verb = data.decision === "approved" ? "Approved" : "Rejected";
      showMessage(
        dashboardResult,
        `${verb}: ${req.name} — ${req.leaveType}, ${req.startDate} to ${req.endDate} (${req.daysRequested} day(s)).`,
        false
      );
      item.remove();
      if (!requestList.children.length) {
        requestList.innerHTML = '<p class="empty-state">No pending requests right now.</p>';
      }
      if (data.decision === "approved" && data.pdfData) {
        try {
          await downloadApprovedLeaveFormPdf(data.pdfData);
        } catch (pdfErr) {
          showMessage(dashboardResult, "Approved, but the leave form PDF could not be generated.", true);
        }
      }
    } else {
      showMessage(dashboardResult, data.message || "Could not process this request.", true);
      buttons.forEach((b) => b.classList.remove("busy"));
    }
  } catch (err) {
    showMessage(dashboardResult, "Could not reach the server. Please try again later.", true);
    buttons.forEach((b) => b.classList.remove("busy"));
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
