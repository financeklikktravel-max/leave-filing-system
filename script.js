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
      showResult(`Request submitted (${data.daysRequested} day(s)) and is now pending approval. A confirmation email has been sent.`, false);
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
