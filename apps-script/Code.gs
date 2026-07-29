// Deploy this file to a Google Sheet (Extensions > Apps Script), then
// Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
// Paste the resulting URL into config.js in the web form.

const CREDITS_SHEET = "Leave Credits";
const REQUESTS_SHEET = "Leave Requests";

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
  const creditsSheet = ss.getSheetByName(CREDITS_SHEET);
  const requestsSheet = ss.getSheetByName(REQUESTS_SHEET);

  const daysRequested = countDays(data.startDate, data.endDate);
  const creditColumn = leaveTypeToColumn(data.leaveType);

  const creditsData = creditsSheet.getDataRange().getValues();
  const headerRow = creditsData[0];
  const emailCol = headerRow.indexOf("Email");
  const creditCol = headerRow.indexOf(creditColumn);

  let employeeRowIndex = -1;
  for (let i = 1; i < creditsData.length; i++) {
    if (String(creditsData[i][emailCol]).toLowerCase() === String(data.email).toLowerCase()) {
      employeeRowIndex = i;
      break;
    }
  }

  const timestamp = new Date();

  if (employeeRowIndex === -1) {
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Employee not found", "");
    return { status: "rejected", message: "Employee not found in Leave Credits sheet." };
  }

  if (creditCol === -1) {
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Unknown leave type", "");
    return { status: "rejected", message: "Unknown leave type: " + data.leaveType };
  }

  const currentCredits = Number(creditsData[employeeRowIndex][creditCol]) || 0;

  if (data.leaveType !== "Unpaid" && currentCredits < daysRequested) {
    logRequest(requestsSheet, timestamp, data, daysRequested, "Rejected - Insufficient credits", currentCredits);
    return {
      status: "rejected",
      message: `Insufficient ${data.leaveType} credits. Available: ${currentCredits}, requested: ${daysRequested}.`,
    };
  }

  let remainingCredits = currentCredits;
  if (data.leaveType !== "Unpaid") {
    remainingCredits = currentCredits - daysRequested;
    creditsSheet.getRange(employeeRowIndex + 1, creditCol + 1).setValue(remainingCredits);
  }

  logRequest(requestsSheet, timestamp, data, daysRequested, "Approved", remainingCredits);

  if (data.email) {
    try {
      MailApp.sendEmail(data.email,
        "Leave Request Approved",
        `Hi ${data.name},\n\nYour ${data.leaveType} leave request (${data.startDate} to ${data.endDate}, ${daysRequested} day(s)) has been approved.\nRemaining ${data.leaveType} credits: ${remainingCredits}.\n\nThank you.`);
    } catch (mailErr) {
      // Non-fatal: request already recorded even if email fails.
    }
  }

  return { status: "approved", daysRequested, remainingCredits };
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

function leaveTypeToColumn(leaveType) {
  const map = {
    Vacation: "Vacation Credits",
    Sick: "Sick Credits",
    Emergency: "Emergency Credits",
    Unpaid: "Unpaid",
  };
  return map[leaveType] || null;
}
