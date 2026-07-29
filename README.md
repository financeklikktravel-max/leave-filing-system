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

2. **Add one new tab** to the same spreadsheet, named exactly
   `Leave Requests`, with this header row only (rows are appended
   automatically by the script):

   | Timestamp | Employee Name | Email | Leave Type | Start Date | End Date | Days Requested | Reason | Status | Remaining Credits |
   |---|---|---|---|---|---|---|---|---|---|

3. **Add the backend script**: in the Sheet, go to `Extensions > Apps Script`,
   paste the contents of `apps-script/Code.gs`, and save.

4. **Deploy as a Web App**: `Deploy > New deployment > Web app`.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy the resulting Web App URL.

5. **Configure the form**: paste that URL into `config.js`:

   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXXX/exec";
   ```

6. **Host the form**: enable GitHub Pages for this repo (Settings > Pages >
   deploy from `main` branch, root folder), or open `index.html` locally to
   test.

## Notes

- **Leave W/O Pay** is deducted the same as the other two leave types, since
  the sheet gives it a tracked balance (5 days) rather than treating it as
  unlimited.
- "Remaining Credits" is recalculated automatically after every approved
  request, as the sum of the employee's remaining Leave With Pay, Leave W/O
  Pay, and Sick Leave balances.
- Re-deploy the Apps Script Web App (as a **new version**) after editing
  `Code.gs`, otherwise changes won't take effect.
- Employee lookup is by **name**, so the name selected in the form must match
  the name in the credits sheet exactly (case/whitespace-insensitive).
