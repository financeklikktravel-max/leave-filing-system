# Leave Filing System — Klikk Travel

A lightweight employee leave request form. Submissions are validated against
each employee's leave credit balance (auto-rejected if insufficient), then
held as **pending** until an approver reviews them on a separate login-gated
page. Approving deducts the days used and notifies the employee by email.

## How it works

- `index.html` / `style.css` / `script.js` — the web form employees fill out.
- `approve.html` / `approve.css` / `approve.js` — the approver-only page:
  login with a username/password, then approve or reject pending requests.
- `apps-script/Code.gs` — a Google Apps Script backend (deployed as a Web App)
  that receives submissions, checks credits, authenticates approvers, and
  deducts credits / emails the employee once a request is decided.

No server hosting is required: the form can be hosted on GitHub Pages (or any
static host), and the Apps Script Web App acts as the backend, reading and
writing directly to your Google Sheet.

## Setup

This is wired up for the existing Klikk Travel leave credits sheet:
https://docs.google.com/spreadsheets/d/13boJkfbEZi9qm_5a4r10IC6EeLNdH82eDQdGlg-MfnY

1. **The first tab** of that spreadsheet already has the credits table
   (`Employee's Name | Leave With Pay | Leave W/O Pay | Sick Leave |
   Remaining Credits`) — no changes needed there. `Code.gs` reads/writes it
   by column header, so header wording can vary in casing/spacing as long as
   each contains "NAME", "WITH PAY", "W/O PAY", "SICK", and "REMAINING".

   Employees are matched **by name** (case-insensitive, trimmed) since there
   is no email column — the name typed in the form must match the sheet
   exactly. To avoid typos, `index.html` uses a dropdown pre-filled with the
   25 current employee names. **If you add/remove employees, update both**
   the credits sheet and the `<select id="name">` options in `index.html`.

2. **Add a tab** to the same spreadsheet, named exactly `Leave Requests`,
   with this header row (rows are appended automatically by the script):

   | Timestamp | Employee Name | Email | Leave Type | Start Date | End Date | Days Requested | Reason | Status | Remaining Credits | Request ID | Decided By | Decided At |
   |---|---|---|---|---|---|---|---|---|---|---|---|---|

3. **Add another tab**, named exactly `Approvers`, with this header row.
   Add one row per approver (see step 6 for generating the password hash):

   | Username | Password Hash | Full Name |
   |---|---|---|

4. **Add the backend script**: in the Sheet, go to `Extensions > Apps Script`,
   paste the contents of `apps-script/Code.gs`, and save.

5. **Deploy as a Web App**: `Deploy > New deployment > Web app`.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy the resulting Web App URL.

6. **Create approver accounts**. Passwords are never stored in plain text —
   only a SHA-256 hash. For each approver:
   - In the Apps Script editor, open `generateApproverHash()` at the bottom
     of `Code.gs` and temporarily set `PASSWORD_TO_HASH` to their chosen
     password.
   - Select `generateApproverHash` in the function dropdown (top toolbar)
     and click **Run**.
   - Open **View > Executions**, click the run, and copy the logged hash.
   - Paste a new row into the **Approvers** tab: their username, the hash,
     and their full name.
   - Set `PASSWORD_TO_HASH` back to `""` and save, so the plaintext password
     isn't left sitting in the script.
   - Re-deploy (**Deploy > Manage deployments** → edit → New version) after
     saving.

7. **Configure the form**: paste the Web App URL into `config.js` (used by
   both `index.html` and `approve.html`):

   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXXX/exec";
   ```

8. **Host the site**: enable GitHub Pages for this repo (Settings > Pages >
   deploy from `main` branch, root folder), or open the HTML files locally
   to test. Employees use `index.html`; approvers use `approve.html`.

## Notes

- **Leave W/O Pay** is deducted the same as the other two leave types, since
  the sheet gives it a tracked balance (5 days) rather than treating it as
  unlimited.
- Insufficient credits are still auto-rejected at submission time — approvers
  only see requests that already passed the credit check. Approving
  re-checks the balance at decision time (in case another request was
  approved in the meantime) and recalculates "Remaining Credits" as the sum
  of the employee's remaining Leave With Pay, Leave W/O Pay, and Sick Leave.
- Re-deploy the Apps Script Web App (as a **new version**) after editing
  `Code.gs`, otherwise changes won't take effect.
- Employee lookup is by **name**, so the name selected in the form must match
  the name in the credits sheet exactly (case/whitespace-insensitive).
- Approver sessions last 6 hours (Apps Script's cache limit), then require
  logging in again.
- `approve.html` is reachable by anyone who knows/guesses the URL, but is
  gated by the username/password login — anyone without valid approver
  credentials cannot view or act on requests.
