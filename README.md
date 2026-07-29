# Leave Filing System — Klikk Travel

A lightweight employee leave request form. Submissions are written to a Google
Sheet, validated against each employee's leave credit balance, and approved
requests automatically deduct the days used.

## How it works

- `index.html` / `style.css` / `script.js` — the web form employees fill out.
- `apps-script/Code.gs` — a Google Apps Script backend (deployed as a Web App)
  that receives submissions, checks/deducts credits in a Google Sheet, logs
  every request, and emails the employee a confirmation.

No server hosting is required: the form can be hosted on GitHub Pages (or any
static host), and the Apps Script Web App acts as the backend, reading and
writing directly to your Google Sheet.

## Setup

1. **Create a Google Sheet** with two tabs:

   **Leave Credits**

   | Employee Name | Email | Vacation Credits | Sick Credits | Emergency Credits |
   |---|---|---|---|---|
   | Jane Doe | jane@klikktravel.com | 15 | 10 | 3 |

   **Leave Requests** (header row only — rows are appended automatically)

   | Timestamp | Employee Name | Email | Leave Type | Start Date | End Date | Days Requested | Reason | Status | Remaining Credits |
   |---|---|---|---|---|---|---|---|---|---|

2. **Add the backend script**: in the Sheet, go to `Extensions > Apps Script`,
   paste the contents of `apps-script/Code.gs`, and save.

3. **Deploy as a Web App**: `Deploy > New deployment > Web app`.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy the resulting Web App URL.

4. **Configure the form**: paste that URL into `config.js`:

   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXXX/exec";
   ```

5. **Host the form**: enable GitHub Pages for this repo (Settings > Pages >
   deploy from `main` branch, root folder), or open `index.html` locally to
   test.

## Notes

- "Unpaid" leave is logged but does not deduct any credit balance.
- Re-deploy the Apps Script Web App (as a **new version**) after editing
  `Code.gs`, otherwise changes won't take effect.
- Employee lookup is by email, so the email entered in the form must match
  the email in the **Leave Credits** sheet exactly.
