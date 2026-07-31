const form = document.getElementById("leaveForm");
const resultBox = document.getElementById("result");
const submitBtn = document.getElementById("submitBtn");
const daysPreview = document.getElementById("daysPreview");

function showResult(message, isError) {
  resultBox.textContent = message;
  resultBox.classList.remove("hidden", "success", "error");
  resultBox.classList.add(isError ? "error" : "success");
}

function countDays(startDate, endDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(endDate) - new Date(startDate)) / msPerDay) + 1;
}

function updateDaysPreview() {
  const startDate = form.startDate.value;
  const endDate = form.endDate.value;
  const leaveType = form.leaveType.value;

  if (!startDate || !endDate) {
    daysPreview.classList.add("hidden");
    return;
  }

  const days = countDays(startDate, endDate);
  if (days < 1) {
    daysPreview.textContent = "End date cannot be before start date.";
  } else {
    const typeLabel = leaveType ? ` from your ${leaveType} balance` : "";
    daysPreview.textContent = `This request is for ${days} day(s)${typeLabel}.`;
  }
  daysPreview.classList.remove("hidden");
}

form.startDate.addEventListener("change", updateDaysPreview);
form.endDate.addEventListener("change", updateDaysPreview);
form.leaveType.addEventListener("change", updateDaysPreview);

function formatDisplayDate(dateString) {
  const d = new Date(dateString + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function addDays(dateString, amount) {
  const d = new Date(dateString + "T00:00:00");
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}

function setCheckbox(id, checked) {
  const el = document.getElementById(id);
  if (el) el.textContent = checked ? "✓" : "";
}

async function downloadLeaveFormPdf(payload, daysRequested) {
  document.getElementById("pdfName").textContent = payload.name;
  document.getElementById("pdfSubmitDate").textContent = formatDisplayDate(new Date().toISOString().slice(0, 10));
  document.getElementById("pdfPosition").textContent = payload.position;
  document.getElementById("pdfBranch").textContent = payload.branch;
  document.getElementById("pdfStartDate").textContent = formatDisplayDate(payload.startDate);
  document.getElementById("pdfEndDate").textContent = formatDisplayDate(payload.endDate);
  document.getElementById("pdfDays").textContent = daysRequested;
  document.getElementById("pdfBackToWork").textContent = formatDisplayDate(addDays(payload.endDate, 1));
  document.getElementById("pdfReason").textContent = payload.reason;

  setCheckbox("pdfCheckVacation", payload.leaveType === "Leave With Pay");
  setCheckbox("pdfCheckSick", payload.leaveType === "Sick Leave");
  setCheckbox("pdfCheckPaternity", false);
  setCheckbox("pdfCheckMaternity", false);
  document.getElementById("pdfOthersSpecify").textContent = payload.leaveType === "Leave W/O Pay" ? "Leave Without Pay" : "";

  setCheckbox("pdfWithPayBox", payload.leaveType !== "Leave W/O Pay");
  setCheckbox("pdfWithoutPayBox", payload.leaveType === "Leave W/O Pay");

  const template = document.getElementById("leaveFormTemplate");
  const canvas = await html2canvas(template, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);

  const fileSafeName = payload.name.replace(/[^a-z0-9]+/gi, "-");
  pdf.save(`Leave-Form-${fileSafeName}-${payload.startDate}.pdf`);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("PASTE_YOUR")) {
    showResult("Setup incomplete: add your Apps Script Web App URL in config.js", true);
    return;
  }

  const startDate = form.startDate.value;
  const endDate = form.endDate.value;
  if (new Date(endDate) < new Date(startDate)) {
    showResult("End date cannot be before start date.", true);
    return;
  }

  const payload = {
    action: "submit",
    name: form.name.value.trim(),
    email: form.email.value.trim(),
    position: form.position.value.trim(),
    branch: form.branch.value.trim(),
    leaveType: form.leaveType.value,
    startDate,
    endDate,
    reason: form.reason.value.trim(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (data.status === "pending") {
      showResult(`Request submitted (${data.daysRequested} day(s)) and is now pending approval. A confirmation email has been sent, and your leave form PDF is downloading.`, false);
      try {
        await downloadLeaveFormPdf(payload, data.daysRequested);
      } catch (pdfErr) {
        showResult("Request submitted, but the leave form PDF could not be generated.", true);
      }
      form.reset();
      daysPreview.classList.add("hidden");
    } else if (data.status === "rejected") {
      showResult(`Request submitted but rejected: ${data.message}`, true);
    } else {
      showResult(data.message || "Something went wrong.", true);
    }
  } catch (err) {
    showResult("Could not reach the server. Please try again later.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Request";
  }
});
