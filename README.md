# Carbonique Field Log

A small web app to plan and record field work at each site.

**Off site** tab: plan the work. Add the tasks to do at each site (with details and priority), edit them, delete them, and add notes before going out.

**On site** tab: in the field. Start a visit, then switch each pending task to **Done** with one tap. Anything else you did that was not on the list goes in **Log other work done** (or **Save as to do for later** if you found a new problem). You can add notes on any task and on the visit in general.

**History** tab: every visit per site with an automatic summary (Copy text / Copy Markdown, ready to paste into EcoFlux), plus a searchable list of every task with its notes and a CSV export.

**Admin** tab (admins only): add, edit and delete sites; add or remove people by email and choose if they are Member or Admin.

The site is static (GitHub Pages). Logins and data live in Firebase, Google's free backend. Nothing secret is stored in the code, so the GitHub repository can be public.

---

## Setup (about 20 minutes, once)

### Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** (e.g. `carbonique-field-log`). Google Analytics is not needed.
3. On the project home page click the **Web** icon (`</>`), give the app a nickname, do **not** tick Firebase Hosting, and click **Register app**.
4. Firebase shows a `firebaseConfig = { ... }` block. Copy the values into **`js/config.js`** in this folder (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). These values are meant to be public; security comes from the rules in step 7.

### Turn on logins

5. Left menu: **Build > Authentication > Get started > Sign-in method > Email/Password**, enable the first switch, **Save**.

### Create the database

6. Left menu: **Build > Firestore Database > Create database**.
   * Edition: **Standard**.
   * Location: **northamerica-northeast1 (Montréal)**.
   * Start in **production mode**.
7. Open the **Rules** tab. Delete what is there, paste the whole content of **`firestore.rules`**, and replace `your.admin@email.com` with the admin's email address (lowercase). Click **Publish**.

   To have more than one owner: `['you@uqam.ca', 'someone@mcgill.ca']`. Usually one is enough, because the admin can promote others to Admin from inside the app.

### Put the site on GitHub Pages

8. On GitHub, create a new repository (e.g. `field-log`). Public is fine.
9. Upload every file in this folder, keeping the folders (`index.html`, `css/`, `js/`, `img/`, `README.md`, `firestore.rules`, `.nojekyll`). The easiest way is **Add file > Upload files** and drag the folder contents in.
10. Repository **Settings > Pages**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**, **Save**. After a minute the site is at `https://YOUR-USERNAME.github.io/field-log/`.
11. Back in Firebase: **Authentication > Settings > Authorized domains > Add domain**, add `YOUR-USERNAME.github.io`.

### First login as admin

12. Open the site, choose **Create account**, and use the admin email from step 7 with your chosen password.
13. Firebase emails you a confirmation link (check spam; it comes from `noreply@...firebaseapp.com`). Click it, go back to the app and press **Continue**.
14. You are in as admin. Go to **Admin**, add your sites and your team.

The admin password is never written in the code: it is only stored (encrypted) by Firebase. You can change it any time with **Forgot password?** on the sign-in screen.

---

## Adding people

1. Admin tab > Team: enter their email, name and role, **Add person**.
2. Send them the site link. They choose **Create account** with that same email, confirm the email they receive, and they are in.

Anyone who creates an account with an email that is not on the team list only sees "Not on the team yet" and cannot read or write anything. Removing someone from the team cuts their access immediately; what they wrote stays in the log.

| | Member | Admin |
|---|---|---|
| See all sites, tasks, notes, history | yes | yes |
| Start / end visits, add tasks, tick them off, write notes | yes | yes |
| Edit or delete own notes | yes | yes |
| Delete a pending task they created | yes | yes |
| Delete any task, note or visit | no | yes |
| Add, rename, delete sites | no | yes |
| Add, remove people, change roles | no | yes |

---

## How a visit works

1. **Off site** (at the office): add what needs doing at the site.
2. **On site**: pick the site at the top and **Start visit** (date and crew are editable).
3. Switch tasks to **Done** as you finish them. Tap a task title to see its details and add a note.
4. Did something that was not planned? **Log other work done** (optional note). Found a new problem to fix another day? Same box, **Save as to do for later**.
5. General observations (weather, water level, access) go in **Visit notes**.
6. **End visit** shows the summary; copy it and paste it into EcoFlux. You can always find it again in **History**.

Several people can work on the same visit at once from different phones; everything syncs live. Unticking a task records an automatic note so the history stays complete. A closed visit can be reopened from History if something was forgotten.

The summary lists: work completed (with notes), tasks worked on but not finished, new issues logged, visit notes, and all tasks still open at the site after the visit.

---

## Try it without Firebase (demo mode)

While `apiKey` in `js/config.js` is empty, the app runs in **demo mode**: everything is stored only in your browser. Create an account with `admin@example.com` (any password) to be the admin. You can also force demo mode on the live site by adding `?demo` to the address.

To run it on your own computer, serve the folder (opening `index.html` directly will not work because of browser security for modules):

```
cd field-log
python -m http.server 8000
```

then open <http://localhost:8000>.

---

## Good to know

* **Cost**: the Firebase free plan (Spark) allows 50,000 reads and 20,000 writes per day and 1 GB of data. A field team uses a tiny fraction of that. No credit card needed.
* **Weak signal**: open the app while you still have signal. If the connection drops afterwards, it keeps showing the site's data and accepts ticks and notes; they are sent automatically when the signal returns. Keep the page open until then.
* **Backups**: History > All tasks > **Export CSV** saves a site's full task list with all notes (opens in Excel).
* **App title**: change `APP_TITLE` (browser tab) and `APP_NAME` (next to the logo) in `js/config.js`.
* **Branding**: Carbonique colors (green `#8ec161`, yellow `#f7c200`, blue `#54b4cc`, brown `#77633c`), Roboto font, and the official CQ logo. The colors are set at the top of `css/style.css`.
* **Add to home screen**: on a phone, open the site and use "Add to Home Screen" for an app-like icon.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `css/style.css` | Styles in the Carbonique palette (light and dark mode) |
| `img/` | Official CQ logo files (favicon and originals) |
| `js/logo.js` | The CQ logos inlined for the header and sign-in screen |
| `js/config.js` | Your Firebase settings and app title |
| `js/app.js` | The app |
| `js/summary.js` | Visit summaries and CSV export |
| `js/backend-firebase.js` | Connection to Firebase |
| `js/backend-demo.js` | In-browser demo storage |
| `firestore.rules` | Security rules to paste into Firebase |
