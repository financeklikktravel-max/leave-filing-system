// Deploy this file to your Google Sheet (Extensions > Apps Script), then
// Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
// Paste the resulting URL into config.js in the web form.
//
// Expects the FIRST sheet/tab of the spreadsheet to be the existing credits
// table with columns (any casing/spacing): Employee's Name | Leave With Pay |
// Leave W/O Pay | Sick Leave | Remaining Credits.
//
// Expects a tab named exactly "Leave Requests" with columns: Timestamp |
// Employee Name | Email | Leave Type | Start Date | End Date |
// Days Requested | Reason | Status | Remaining Credits | Request ID |
// Approved By | Decided At.
//
// Expects a tab named exactly "Approvers" with columns: Username |
// Password Hash | Full Name. See generateApproverHash() below for creating
// a password hash to paste into that sheet.

const REQUESTS_SHEET = "Leave Requests";
const APPROVERS_SHEET = "Approvers";
const SESSION_DURATION_SECONDS = 6 * 60 * 60; // Apps Script cache max is 6 hours

const LEAVE_TYPE_MATCH = {
  "Leave With Pay": "WITH PAY",
  "Leave W/O Pay": "W/O PAY",
  "Sick Leave": "SICK",
};

// Leave types listed here are never checked against balance and never
// deducted -- treated as unlimited.
const UNLIMITED_LEAVE_TYPES = ["Leave With Pay"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Server is busy handling another request. Please try again in a moment.",
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || "submit";
    let result;

    if (action === "submit") {
      result = processLeaveRequest(data);
    } else if (action === "login") {
      result = login(data.username, data.password);
    } else if (action === "listPending") {
      result = listPendingRequests(data.token);
    } else if (action === "listDecided") {
      result = listDecidedRequests(data.token);
    } else if (action === "decide") {
      result = decideRequest(data.token, data.requestId, data.decision);
    } else {
      result = { status: "error", message: "Unknown action: " + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.message,
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ---------- Leave request submission ----------

function processLeaveRequest(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const creditsSheet = ss.getSheets()[0];
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);

  const daysRequested = countDays(data.startDate, data.endDate);

  const creditsData = creditsSheet.getDataRange().getValues();
  const headerRow = normalizeHeaderRow(creditsData[0]);

  const nameCol = headerRow.findIndex((h) => h.indexOf("NAME") !== -1);
  const matchKeyword = LEAVE_TYPE_MATCH[data.leaveType];
  const creditCol = matchKeyword
    ? headerRow.findIndex((h) => h.indexOf(matchKeyword) !== -1)
    : -1;

  const employeeRowIndex = findRowByColumnValue(creditsData, nameCol, data.name);
  const timestamp = new Date();
  const requestId = Utilities.getUuid();

  if (employeeRowIndex === -1) {
    const message = "Employee name not found in credits sheet. It must match exactly.";
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Employee not found", "", requestId);
    notifySubmission(data, daysRequested, "rejected", message);
    return { status: "rejected", message };
  }

  if (creditCol === -1) {
    const message = "Unknown leave type: " + data.leaveType;
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Unknown leave type", "", requestId);
    notifySubmission(data, daysRequested, "rejected", message);
    return { status: "rejected", message };
  }

  const isUnlimited = UNLIMITED_LEAVE_TYPES.indexOf(data.leaveType) !== -1;
  const currentCredits = Number(creditsData[employeeRowIndex][creditCol]) || 0;

  if (!isUnlimited && currentCredits < daysRequested) {
    const message = `Insufficient ${data.leaveType} credits. Available: ${currentCredits}, requested: ${daysRequested}.`;
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Insufficient credits", "", requestId);
    notifySubmission(data, daysRequested, "rejected", message);
    return { status: "rejected", message };
  }

  logRequest(requestsSheet, timestamp, data, daysRequested, "Pending Approval", "", requestId);
  notifySubmission(data, daysRequested, "pending", "");

  return { status: "pending", daysRequested, requestId };
}

function logRequest(sheet, timestamp, data, daysRequested, status, remainingCredits, requestId) {
  sheet.appendRow([
    timestamp,
    data.name,
    data.email,
    data.leaveType,
    data.startDate,
    data.endDate,
    daysRequested,
    data.reason,
    status,
    remainingCredits,
    requestId,
    "",
    "",
  ]);
}

// ---------- Approver login ----------

function login(username, password) {
  if (!username || !password) {
    return { status: "error", message: "Username and password required." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const approversSheet = ss.getSheetByName(APPROVERS_SHEET);
  if (!approversSheet) {
    return { status: "error", message: "Approvers sheet not found." };
  }

  const data = approversSheet.getDataRange().getValues();
  const headerRow = normalizeHeaderRow(data[0]);
  const userCol = headerRow.findIndex((h) => h.indexOf("USERNAME") !== -1);
  const hashCol = headerRow.findIndex((h) => h.indexOf("PASSWORD") !== -1);
  const nameCol = headerRow.findIndex((h) => h.indexOf("FULL NAME") !== -1 || h.indexOf("NAME") !== -1);

  const rowIndex = findRowByColumnValue(data, userCol, username);
  if (rowIndex === -1) {
    return { status: "error", message: "Invalid username or password." };
  }

  const storedHash = String(data[rowIndex][hashCol]).trim();
  if (storedHash !== hashPassword(password)) {
    return { status: "error", message: "Invalid username or password." };
  }

  const fullName = nameCol !== -1 ? data[rowIndex][nameCol] : username;
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("session_" + token, JSON.stringify({ username, fullName }), SESSION_DURATION_SECONDS);

  return { status: "ok", token, fullName };
}

function requireSession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get("session_" + token);
  return raw ? JSON.parse(raw) : null;
}

// ---------- Listing and deciding pending requests ----------

function listPendingRequests(token) {
  const session = requireSession(token);
  if (!session) {
    return { status: "error", message: "Session expired. Please log in again." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);
  const data = requestsSheet.getDataRange().getValues();
  const headerRow = normalizeHeaderRow(data[0]);
  const cols = requestsColumnIndexes(headerRow);

  const pending = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cols.status]).trim() === "Pending Approval") {
      pending.push({
        requestId: data[i][cols.requestId],
        timestamp: data[i][cols.timestamp],
        name: data[i][cols.name],
        email: data[i][cols.email],
        leaveType: data[i][cols.leaveType],
        startDate: formatDateCell(data[i][cols.startDate]),
        endDate: formatDateCell(data[i][cols.endDate]),
        daysRequested: data[i][cols.daysRequested],
        reason: data[i][cols.reason],
      });
    }
  }

  return { status: "ok", requests: pending };
}

function listDecidedRequests(token) {
  const session = requireSession(token);
  if (!session) {
    return { status: "error", message: "Session expired. Please log in again." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);
  const data = requestsSheet.getDataRange().getValues();
  const headerRow = normalizeHeaderRow(data[0]);
  const cols = requestsColumnIndexes(headerRow);

  const decided = [];
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][cols.status]).trim();
    if (status === "Approved" || status === "Rejected by Approver") {
      const decidedAtValue = data[i][cols.decidedAt];
      decided.push({
        requestId: data[i][cols.requestId],
        name: data[i][cols.name],
        email: data[i][cols.email],
        leaveType: data[i][cols.leaveType],
        startDate: formatDateCell(data[i][cols.startDate]),
        endDate: formatDateCell(data[i][cols.endDate]),
        daysRequested: data[i][cols.daysRequested],
        reason: data[i][cols.reason],
        status: status,
        approvedBy: data[i][cols.decidedBy],
        decidedAt: decidedAtValue instanceof Date
          ? Utilities.formatDate(decidedAtValue, Session.getScriptTimeZone(), "MMM d, yyyy h:mm a")
          : decidedAtValue,
      });
    }
  }

  decided.reverse();
  return { status: "ok", requests: decided.slice(0, 50) };
}

function decideRequest(token, requestId, decision) {
  const session = requireSession(token);
  if (!session) {
    return { status: "error", message: "Session expired. Please log in again." };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { status: "error", message: "Invalid decision: " + decision };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);
  const data = requestsSheet.getDataRange().getValues();
  const headerRow = normalizeHeaderRow(data[0]);
  const cols = requestsColumnIndexes(headerRow);

  const rowIndex = findRowByColumnValue(data, cols.requestId, requestId);
  if (rowIndex === -1) {
    return { status: "error", message: "Request not found." };
  }
  if (String(data[rowIndex][cols.status]).trim() !== "Pending Approval") {
    return { status: "error", message: "This request has already been decided." };
  }

  const employeeName = data[rowIndex][cols.name];
  const employeeEmail = data[rowIndex][cols.email];
  const leaveType = data[rowIndex][cols.leaveType];
  const daysRequested = Number(data[rowIndex][cols.daysRequested]) || 0;
  const decidedAt = new Date();
  const sheetRow = rowIndex + 1;

  if (decision === "reject") {
    requestsSheet.getRange(sheetRow, cols.status + 1).setValue("Rejected by Approver");
    requestsSheet.getRange(sheetRow, cols.decidedBy + 1).setValue(session.fullName);
    requestsSheet.getRange(sheetRow, cols.decidedAt + 1).setValue(decidedAt);
    notifyEmployee(employeeEmail, employeeName, leaveType, "rejected", null);
    return { status: "ok", decision: "rejected" };
  }

  // Approve: re-check current balance in case it changed since submission.
  const creditsSheet = ss.getSheets()[0];
  const creditsData = creditsSheet.getDataRange().getValues();
  const creditsHeader = normalizeHeaderRow(creditsData[0]);
  const nameCol = creditsHeader.findIndex((h) => h.indexOf("NAME") !== -1);
  const remainingCol = creditsHeader.findIndex((h) => h.indexOf("REMAINING") !== -1);
  const matchKeyword = LEAVE_TYPE_MATCH[leaveType];
  const creditCol = matchKeyword ? creditsHeader.findIndex((h) => h.indexOf(matchKeyword) !== -1) : -1;
  const employeeRowIndex = findRowByColumnValue(creditsData, nameCol, employeeName);

  if (employeeRowIndex === -1 || creditCol === -1) {
    return { status: "error", message: "Could not locate employee or leave type in credits sheet." };
  }

  const isUnlimited = UNLIMITED_LEAVE_TYPES.indexOf(leaveType) !== -1;
  const currentCredits = Number(creditsData[employeeRowIndex][creditCol]) || 0;

  if (!isUnlimited && currentCredits < daysRequested) {
    return { status: "error", message: `Cannot approve: only ${currentCredits} ${leaveType} credit(s) remain, ${daysRequested} requested.` };
  }

  const updatedCredits = isUnlimited ? currentCredits : currentCredits - daysRequested;
  if (!isUnlimited) {
    creditsSheet.getRange(employeeRowIndex + 1, creditCol + 1).setValue(updatedCredits);
  }

  if (remainingCol !== -1) {
    const row = creditsData[employeeRowIndex].slice();
    row[creditCol] = updatedCredits;
    const totalRemaining = Object.keys(LEAVE_TYPE_MATCH)
      .map((type) => creditsHeader.findIndex((h) => h.indexOf(LEAVE_TYPE_MATCH[type]) !== -1))
      .filter((col) => col !== -1)
      .reduce((sum, col) => sum + (Number(row[col]) || 0), 0);
    creditsSheet.getRange(employeeRowIndex + 1, remainingCol + 1).setValue(totalRemaining);
  }

  requestsSheet.getRange(sheetRow, cols.status + 1).setValue("Approved");
  requestsSheet.getRange(sheetRow, cols.remainingCredits + 1).setValue(updatedCredits);
  requestsSheet.getRange(sheetRow, cols.decidedBy + 1).setValue(session.fullName);
  requestsSheet.getRange(sheetRow, cols.decidedAt + 1).setValue(decidedAt);

  notifyEmployee(employeeEmail, employeeName, leaveType, "approved", updatedCredits);

  return { status: "ok", decision: "approved" };
}

function notifyEmployee(email, name, leaveType, outcome, remainingCredits) {
  if (!email) return;
  try {
    const isUnlimited = UNLIMITED_LEAVE_TYPES.indexOf(leaveType) !== -1;
    const subject = outcome === "approved" ? "Leave Request Approved" : "Leave Request Rejected";
    const body = outcome === "approved"
      ? `Hi ${name},\n\nYour ${leaveType} leave request has been approved.\n${isUnlimited ? `${leaveType} is unlimited and is not deducted from your credits.` : `Remaining ${leaveType} credits: ${remainingCredits}.`}\n\nThank you.`
      : `Hi ${name},\n\nYour ${leaveType} leave request has been rejected by your approver.\n\nThank you.`;
    MailApp.sendEmail(email, subject, body);
  } catch (mailErr) {
    // Non-fatal: decision already recorded even if email fails.
  }
}

function notifySubmission(data, daysRequested, outcome, message) {
  if (!data.email) return;
  try {
    const subject = outcome === "pending" ? "Leave Request Received" : "Leave Request Not Submitted";
    const body = outcome === "pending"
      ? `Hi ${data.name},\n\nWe received your ${data.leaveType} leave request from ${data.startDate} to ${data.endDate} (${daysRequested} day(s)).\nIt is now pending approval. You'll get another email once it's been decided.\n\nThank you.`
      : `Hi ${data.name},\n\nYour ${data.leaveType} leave request from ${data.startDate} to ${data.endDate} (${daysRequested} day(s)) could not be submitted.\nReason: ${message}\n\nThank you.`;
    MailApp.sendEmail(data.email, subject, body);
  } catch (mailErr) {
    // Non-fatal: request already recorded even if email fails.
  }
}

// ---------- Helpers ----------

function formatDateCell(value) {
  return value instanceof Date
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd")
    : value;
}

function normalizeHeaderRow(row) {
  return row.map((h) => String(h).trim().toUpperCase().replace(/\s+/g, " "));
}

function findRowByColumnValue(data, col, value) {
  if (col === -1) return -1;
  const target = String(value).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col]).trim().toLowerCase() === target) return i;
  }
  return -1;
}

function requestsColumnIndexes(headerRow) {
  return {
    timestamp: headerRow.findIndex((h) => h.indexOf("TIMESTAMP") !== -1),
    name: headerRow.findIndex((h) => h.indexOf("EMPLOYEE NAME") !== -1),
    email: headerRow.findIndex((h) => h.indexOf("EMAIL") !== -1),
    leaveType: headerRow.findIndex((h) => h.indexOf("LEAVE TYPE") !== -1),
    startDate: headerRow.findIndex((h) => h.indexOf("START DATE") !== -1),
    endDate: headerRow.findIndex((h) => h.indexOf("END DATE") !== -1),
    daysRequested: headerRow.findIndex((h) => h.indexOf("DAYS REQUESTED") !== -1),
    reason: headerRow.findIndex((h) => h.indexOf("REASON") !== -1),
    status: headerRow.findIndex((h) => h.indexOf("STATUS") !== -1),
    remainingCredits: headerRow.findIndex((h) => h.indexOf("REMAINING CREDITS") !== -1),
    requestId: headerRow.findIndex((h) => h.indexOf("REQUEST ID") !== -1),
    decidedBy: headerRow.findIndex((h) => h.indexOf("APPROVED BY") !== -1),
    decidedAt: headerRow.findIndex((h) => h.indexOf("DECIDED AT") !== -1),
  };
}

function countDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end - start) / msPerDay) + 1;
}

function hashPassword(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return digest.map((b) => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

// Run this function once per approver from the Apps Script editor (select it
// in the function dropdown at the top, click Run) to generate a password
// hash. Temporarily set PASSWORD_TO_HASH below, run, copy the hash from
// View > Executions (or Logger output), paste it into the Approvers sheet's
// "Password Hash" column, then clear PASSWORD_TO_HASH back to "" before
// saving so the plaintext password isn't left in the script.
function generateApproverHash() {
  const PASSWORD_TO_HASH = "";
  Logger.log(hashPassword(PASSWORD_TO_HASH));
}

// One-time cleanup: clears every logged row in "Leave Requests" and resets
// every employee's Leave With Pay / Leave W/O Pay / Sick Leave back to 5
// (their original starting balance), clearing Remaining Credits too. Run
// this manually from the Apps Script editor (select resetTestData in the
// function dropdown, click Run) when you want to wipe test data and start
// clean. This cannot be undone.
function resetTestData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const creditsSheet = ss.getSheets()[0];
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);

  const creditsData = creditsSheet.getDataRange().getValues();
  const headerRow = normalizeHeaderRow(creditsData[0]);
  const withPayCol = headerRow.findIndex((h) => h.indexOf("WITH PAY") !== -1);
  const woPayCol = headerRow.findIndex((h) => h.indexOf("W/O PAY") !== -1);
  const sickCol = headerRow.findIndex((h) => h.indexOf("SICK") !== -1);
  const remainingCol = headerRow.findIndex((h) => h.indexOf("REMAINING") !== -1);

  for (let i = 1; i < creditsData.length; i++) {
    const row = i + 1;
    if (withPayCol !== -1) creditsSheet.getRange(row, withPayCol + 1).setValue(5);
    if (woPayCol !== -1) creditsSheet.getRange(row, woPayCol + 1).setValue(5);
    if (sickCol !== -1) creditsSheet.getRange(row, sickCol + 1).setValue(5);
    if (remainingCol !== -1) creditsSheet.getRange(row, remainingCol + 1).setValue("");
  }

  const lastRow = requestsSheet.getLastRow();
  if (lastRow > 1) {
    requestsSheet.getRange(2, 1, lastRow - 1, requestsSheet.getLastColumn()).clearContent();
  }

  Logger.log("Reset complete: all credits back to 5/5/5, Leave Requests cleared.");
}
