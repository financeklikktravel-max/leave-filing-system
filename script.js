const form = document.getElementById("leaveForm");
const resultBox = document.getElementById("result");
const submitBtn = document.getElementById("submitBtn");

function showResult(message, isError) {
  resultBox.textContent = message;
  resultBox.classList.remove("hidden", "success", "error");
  resultBox.classList.add(isError ? "error" : "success");
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

    if (data.status === "approved") {
      showResult(`Request submitted and approved. ${data.daysRequested} day(s) deducted. Remaining ${payload.leaveType} credits: ${data.remainingCredits}.`, false);
      form.reset();
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
