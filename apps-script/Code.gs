// Deploy this file to your Google Sheet (Extensions > Apps Script), then
// Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
// Paste the resulting URL into config.js in the web form.
//
// Expects the FIRST sheet/tab of the spreadsheet to be the existing credits
// table with columns (any casing/spacing): Employee's Name | Leave With Pay |
// Leave W/O Pay | Sick Leave | Remaining Credits.
//
// Also expects a second tab named exactly "Leave Requests" (create it once,
// header row only) with columns: Timestamp | Employee Name | Email |
// Leave Type | Start Date | End Date | Days Requested | Reason | Status |
// Remaining Credits.

const REQUESTS_SHEET = "Leave Requests";

const LEAVE_TYPE_MATCH = {
  "Leave With Pay": "WITH PAY",
  "Leave W/O Pay": "W/O PAY",
  "Sick Leave": "SICK",
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const data = JSON.parse(e.postData.contents);
    const result = processLeaveRequest(data);
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

function processLeaveRequest(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const creditsSheet = ss.getSheets()[0];
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);

  const daysRequested = countDays(data.startDate, data.endDate);

  const creditsData = creditsSheet.getDataRange().getValues();
  const headerRow = creditsData[0].map((h) => String(h).trim().toUpperCase().replace(/\s+/g, " "));

  const nameCol = headerRow.findIndex((h) => h.indexOf("NAME") !== -1);
  const remainingCol = headerRow.findIndex((h) => h.indexOf("REMAINING") !== -1);
  const matchKeyword = LEAVE_TYPE_MATCH[data.leaveType];
  const creditCol = matchKeyword
    ? headerRow.findIndex((h) => h.indexOf(matchKeyword) !== -1)
    : -1;

  let employeeRowIndex = -1;
  for (let i = 1; i < creditsData.length; i++) {
    if (String(creditsData[i][nameCol]).trim().toLowerCase() === String(data.name).trim().toLowerCase()) {
      employeeRowIndex = i;
      break;
    }
  }

  const timestamp = new Date();

  if (employeeRowIndex === -1) {
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Employee not found", "");
    return { status: "rejected", message: "Employee name not found in credits sheet. It must match exactly." };
  }

  if (creditCol === -1) {
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Unknown leave type", "");
    return { status: "rejected", message: "Unknown leave type: " + data.leaveType };
  }

  const currentCredits = Number(creditsData[employeeRowIndex][creditCol]) || 0;

  if (currentCredits < daysRequested) {
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Insufficient credits", currentCredits);
    return {
      status: "rejected",
      message: `Insufficient ${data.leaveType} credits. Available: ${currentCredits}, requested: ${daysRequested}.`,
    };
  }

  const updatedCredits = currentCredits - daysRequested;
  creditsSheet.getRange(employeeRowIndex + 1, creditCol + 1).setValue(updatedCredits);

  let totalRemaining = updatedCredits;
  if (remainingCol !== -1) {
    const row = creditsData[employeeRowIndex].slice();
    row[creditCol] = updatedCredits;
    totalRemaining = Object.keys(LEAVE_TYPE_MATCH)
      .map((type) => headerRow.findIndex((h) => h.indexOf(LEAVE_TYPE_MATCH[type]) !== -1))
      .filter((col) => col !== -1)
      .reduce((sum, col) => sum + (Number(row[col]) || 0), 0);
    creditsSheet.getRange(employeeRowIndex + 1, remainingCol + 1).setValue(totalRemaining);
  }

  logRequest(requestsSheet, timestamp, data, daysRequested, "Approved", updatedCredits);

  if (data.email) {
    try {
      MailApp.sendEmail(data.email,
        "Leave Request Approved",
        `Hi ${data.name},\n\nYour ${data.leaveType} leave request (${data.startDate} to ${data.endDate}, ${daysRequested} day(s)) has been approved.\nRemaining ${data.leaveType} credits: ${updatedCredits}.\n\nThank you.`);
    } catch (mailErr) {
      // Non-fatal: request already recorded even if email fails.
    }
  }

  return { status: "approved", daysRequested, remainingCredits: updatedCredits };
}

function logRequest(sheet, timestamp, data, daysRequested, status, remainingCredits) {
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
  ]);
}

function countDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end - start) / msPerDay) + 1;
}
