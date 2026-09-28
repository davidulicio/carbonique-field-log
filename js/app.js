import { firebaseConfig, APP_TITLE, APP_NAME, DEMO_ADMIN_EMAIL } from "./config.js";
import { visitSummary, visitStats, tasksCsv } from "./summary.js";
import { LOGO_LONG, LOGO_COMPACT } from "./logo.js";

/* =====================================================================
   Helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => Date.now();
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" }) : "");
const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString("en-CA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const fmtDay = (ymd) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 2600);
}
function showErr(e) {
  console.error(e);
  const code = e?.code || "";
  if (code.includes("permission-denied")) toast("You don't have permission to do that.", true);
  else toast(e?.message || String(e), true);
}
// Writes are not awaited in the UI: the local cache updates the screen at once,
// and Firestore syncs in the background (also when signal is weak).
const w = (p) => Promise.resolve(p).catch(showErr);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  toast("Copied to clipboard");
}

/* ---------- modal ---------- */
function modal({ title, body = "", actions = [{ label: "OK", value: "ok", cls: "primary" }], onOpen }) {
  const dlg = $("#modal"), form = $("#modalForm");
  form.innerHTML = `<h2>${esc(title)}</h2>${body}
    <div class="actions">${actions.map((a) => `<button class="btn ${a.cls || ""}" value="${esc(a.value)}" ${a.novalidate ? "formnovalidate" : ""}>${esc(a.label)}</button>`).join("")}</div>`;
  return new Promise((resolve) => {
    const done = () => {
      dlg.removeEventListener("close", done);
      const values = {};
      $$("[name]", form).forEach((el) => { values[el.name] = el.type === "checkbox" ? el.checked : el.value; });
      resolve({ action: dlg.returnValue, values });
    };
    dlg.returnValue = "";
    dlg.addEventListener("close", done);
    dlg.showModal();
    onOpen && onOpen(form);
    const first = $("input:not([type=hidden]), textarea", form);
    if (first) first.focus();
  });
}
const confirmBox = (title, text, label = "Confirm", cls = "primary") =>
  modal({ title, body: `<p>${text}</p>`, actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label, value: "ok", cls }] })
    .then((r) => r.action === "ok");

/* =====================================================================
   State
   ===================================================================== */
const S = {
  B: null,
  user: null,          // { email, emailVerified }
  me: null,            // my member document
  members: [],
  sites: [],
  siteId: lsGet("fieldlog-site"),
  tasks: [], comments: [], visits: [],
  siteLoaded: false,
  view: lsGet("fieldlog-view") || "offsite",
  histMode: "visits",
  search: "", statusFilter: "all",
  expanded: new Set(),
  openVisits: new Set(),
  authMode: "signin",
  authError: "",
  unsubMe: null, unsubGlobal: [], unsubSite: [],
  bootstrapTried: false,
};
const myName = () => S.me?.name || (S.user?.email || "").split("@")[0];
const isAdmin = () => S.me?.role === "admin";
const site = () => S.sites.find((s) => s.id === S.siteId) || null;
const sitePath = () => `sites/${S.siteId}`;
const openVisit = () => S.visits.filter((v) => v.status === "open").sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
const commentsFor = (taskId) => S.comments.filter((c) => c.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt);
const visitById = (id) => S.visits.find((v) => v.id === id);

/* =====================================================================
   Boot & auth
   ===================================================================== */
async function boot() {
  document.title = APP_TITLE;
  const demo = !firebaseConfig.apiKey || new URLSearchParams(location.search).has("demo");
  try {
    const mod = demo ? await import("./backend-demo.js") : await import("./backend-firebase.js");
    S.B = await mod.createBackend(firebaseConfig, { adminEmail: DEMO_ADMIN_EMAIL });
  } catch (e) {
    console.error(e);
    $("#app").innerHTML = `<div class="auth"><div class="logo">${LOGO_COMPACT}</div><div class="card"><h1>Could not start</h1><p class="error">${esc(e.message || e)}</p><p class="muted">Check your internet connection and the settings in js/config.js.</p></div></div>`;
    return;
  }
  S.B.onAuth(onUser);
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
}

function resetData() {
  S.unsubMe && S.unsubMe(); S.unsubMe = null;
  S.unsubGlobal.forEach((u) => u()); S.unsubGlobal = [];
  S.unsubSite.forEach((u) => u()); S.unsubSite = [];
  S.me = null; S.members = []; S.sites = []; S.tasks = []; S.comments = []; S.visits = [];
  S.bootstrapTried = false; S.siteLoaded = false;
}

function onUser(u) {
  resetData();
  S.user = u;
  if (!u) return renderAuth();
  if (!u.emailVerified) return renderVerify();
  renderLoading();
  S.unsubMe = S.B.watchDoc(`members/${u.email}`, async (doc) => {
    if (doc) {
      const wasIn = !!S.me;
      S.me = doc;
      if (!wasIn) enterApp(); else scheduleRender();
      return;
    }
    // No member record. If this is the owner named in the security rules,
    // create the admin record automatically (rules only let the owner do that).
    S.me = null;
    stopGlobal();
    if (!S.bootstrapTried) {
      S.bootstrapTried = true;
      try {
        // Server-confirmed create (a transaction), so nothing shows up locally unless the rules accept it.
        await S.B.createStrict(`members/${u.email}`, { email: u.email, name: u.email.split("@")[0], role: "admin", addedAt: now(), addedBy: u.email });
        return; // the watcher fires again with the new doc
      } catch (e) { /* not the owner */ }
    }
    renderNoAccess();
  }, (e) => { console.error(e); renderNoAccess(e); });
}

function stopGlobal() {
  S.unsubGlobal.forEach((u) => u()); S.unsubGlobal = [];
  S.unsubSite.forEach((u) => u()); S.unsubSite = [];
}

function enterApp() {
  stopGlobal();
  S.unsubGlobal.push(
    S.B.watchCol("members", (list) => { S.members = list; scheduleRender(); }, showErr),
    S.B.watchCol("sites", (list) => {
      S.sites = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!site() && S.sites.length) selectSite(S.sites[0].id);
      else if (!S.sites.length) { S.siteId = null; S.unsubSite.forEach((u) => u()); S.unsubSite = []; }
      scheduleRender();
    }, showErr),
  );
  if (S.siteId) selectSite(S.siteId);
  scheduleRender();
}

function selectSite(id) {
  S.unsubSite.forEach((u) => u()); S.unsubSite = [];
  S.siteId = id; lsSet("fieldlog-site", id || "");
  S.tasks = []; S.comments = []; S.visits = []; S.siteLoaded = false;
  S.expanded.clear(); S.openVisits.clear();
  if (!id) return scheduleRender();
  let loaded = 0;
  const mark = () => { if (++loaded >= 3) S.siteLoaded = true; };
  const p = `sites/${id}`;
  S.unsubSite.push(
    S.B.watchCol(`${p}/tasks`, (l) => { S.tasks = l; mark(); scheduleRender(); }, showErr),
    S.B.watchCol(`${p}/comments`, (l) => { S.comments = l; mark(); scheduleRender(); }, showErr),
    S.B.watchCol(`${p}/visits`, (l) => { S.visits = l; mark(); scheduleRender(); }, showErr),
  );
  scheduleRender();
}

/* =====================================================================
   Rendering
   ===================================================================== */
let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; if (S.me) renderApp(); });
}

// Keep typed text, checkbox state and focus across re-renders.
function preserve(root, fn) {
  const drafts = {};
  $$("[data-draft]", root).forEach((el) => { drafts[el.dataset.draft] = el.type === "checkbox" ? el.checked : el.value; });
  const act = document.activeElement;
  const focusKey = act && act.dataset ? act.dataset.draft : null;
  const sel = focusKey && "selectionStart" in act ? [act.selectionStart, act.selectionEnd] : null;
  const scroll = window.scrollY;
  fn();
  $$("[data-draft]", root).forEach((el) => {
    const v = drafts[el.dataset.draft];
    if (v === undefined) return;
    if (el.type === "checkbox") el.checked = v; else el.value = v;
  });
  if (focusKey) {
    const el = $(`[data-draft="${CSS.escape(focusKey)}"]`, root);
    if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch {} }
  }
  window.scrollTo(0, scroll);
}

function renderLoading() { $("#app").innerHTML = `<div class="boot">Loading…</div>`; }

function demoBanner() {
  return S.B?.demo
    ? `<div class="banner">Demo mode: data is saved only in this browser. Add your Firebase settings in js/config.js to go live.</div>`
    : "";
}

function renderAuth() {
  const up = S.authMode === "signup";
  $("#app").innerHTML = `${demoBanner()}
  <div class="auth"><div class="logo">${LOGO_COMPACT}</div>
    <h1>${esc(APP_NAME)}</h1>
    <p class="muted">${up ? "Create your account" : "Sign in to continue"}</p>
    <div class="card">
      ${S.authError ? `<div class="error">${esc(S.authError)}</div>` : ""}
      ${up ? `<div class="note">Use the email address the admin added to the team. You will receive an email to confirm it.</div>` : ""}
      ${S.B.demo ? `<div class="note">Demo: create an account with <b>${esc(DEMO_ADMIN_EMAIL)}</b> to be the admin.</div>` : ""}
      <form id="authForm">
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required data-draft="auth-email"></label>
        <label class="field"><span>Password</span><input type="password" name="password" autocomplete="${up ? "new-password" : "current-password"}" required minlength="6" data-draft="auth-pw"></label>
        ${up ? `<label class="field"><span>Repeat password</span><input type="password" name="password2" autocomplete="new-password" required minlength="6"></label>` : ""}
        <button class="btn primary" style="width:100%">${up ? "Create account" : "Sign in"}</button>
      </form>
      <div class="switch">
        ${up
          ? `Already have an account? <button class="btn link" data-act="auth-mode" data-mode="signin">Sign in</button>`
          : `New to the team? <button class="btn link" data-act="auth-mode" data-mode="signup">Create account</button><br>
             <button class="btn link" data-act="forgot">Forgot password?</button>`}
      </div>
    </div>
  </div>`;
}

function renderVerify() {
  $("#app").innerHTML = `${demoBanner()}
  <div class="auth"><div class="logo">${LOGO_COMPACT}</div><h1>Confirm your email</h1>
    <div class="card">
      <p>We sent a confirmation link to <b>${esc(S.user.email)}</b>. Open it (check spam too), then press Continue.</p>
      <div class="btns">
        <button class="btn primary" data-act="verified">Continue</button>
        <button class="btn" data-act="resend">Resend email</button>
        <button class="btn link" data-act="signout">Sign out</button>
      </div>
    </div></div>`;
}

function renderNoAccess(e) {
  $("#app").innerHTML = `${demoBanner()}
  <div class="auth"><div class="logo">${LOGO_COMPACT}</div><h1>Not on the team yet</h1>
    <div class="card">
      <p>You are signed in as <b>${esc(S.user?.email)}</b>, but this email is not on the team list.</p>
      <p class="muted">Ask the admin to add it in <b>Admin, Team</b>. This page opens the app by itself as soon as you are added.</p>
      ${e && !String(e.code || "").includes("permission") ? `<div class="error">${esc(e.message || e)}</div>` : ""}
      <button class="btn" data-act="signout">Sign out</button>
    </div></div>`;
}

function renderApp() {
  const root = $("#app");
  if (!$(".topbar", root)) {
    root.innerHTML = `${demoBanner()}<header class="topbar-wrap"><div class="brand-stripe"></div><div class="topbar"></div></header><main id="view"></main>`;
  }
  const tabs = [["offsite", "Off site"], ["onsite", "On site"], ["history", "History"]];
  if (isAdmin()) tabs.push(["admin", "Admin"]);
  if (S.view === "admin" && !isAdmin()) S.view = "offsite";

  $(".topbar", root).innerHTML = `
    <div class="topbar-row">
      <div class="brand">${LOGO_LONG}<span class="app-name">${esc(APP_NAME)}</span></div>
      ${S.sites.length ? `<select class="site-select" data-act="site" aria-label="Site">
        ${S.sites.map((s) => `<option value="${esc(s.id)}" ${s.id === S.siteId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
      </select>` : ""}
      <div class="userchip"><span class="who">${esc(myName())}${isAdmin() ? " (admin)" : ""}</span><button data-act="signout">Sign out</button></div>
    </div>
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-act="view" data-view="${k}" aria-selected="${S.view === k}">${l}</button>`).join("")}</nav>`;

  const view = $("#view");
  preserve(view, () => {
    if (S.view === "admin") view.innerHTML = adminView();
    else if (!S.sites.length) view.innerHTML = `<div class="card"><h2>No sites yet</h2><p class="muted">${isAdmin() ? "Add your first site in the Admin tab." : "The admin has not added any sites yet."}</p></div>`;
    else if (S.view === "history") view.innerHTML = historyView();
    else if (S.view === "onsite") view.innerHTML = onsiteView();
    else view.innerHTML = offsiteView();
  });
}

/* ---------- task card ---------- */
function canDeleteTask(t) { return isAdmin() || (t.createdByEmail === S.user.email && t.status === "pending"); }
function canEditComment(c) { return isAdmin() || c.authorEmail === S.user.email; }

// mode: "offsite" (plan: edit, delete), "onsite" (toggle + notes), "history" (status pill, full controls)
function taskCard(t, { mode = "offsite" } = {}) {
  const done = t.status === "done";
  const open = S.expanded.has(t.id);
  const cs = commentsFor(t.id);
  const nNotes = cs.filter((c) => !c.system).length;
  const meta = [
    `Added ${fmtDate(t.createdAt)} by ${esc(t.createdBy)}`,
    done ? `Done ${fmtDate(t.doneAt)} by ${esc(t.doneBy)}` : "",
    nNotes ? `${nNotes} note${nNotes > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" · ");
  const toggle = mode === "onsite"
    ? `<label class="toggle"><input type="checkbox" role="switch" data-act="toggle" data-id="${esc(t.id)}" ${done ? "checked" : ""} aria-label="Done"><span class="track"><span class="knob"></span></span><span class="tlabel">${done ? "Done" : "To do"}</span></label>`
    : "";
  const manage = mode !== "onsite"
    ? `<button type="button" class="btn small" data-act="edit-task" data-id="${esc(t.id)}">Edit task</button>
       ${canDeleteTask(t) ? `<button type="button" class="btn danger small" data-act="delete-task" data-id="${esc(t.id)}">Delete</button>` : ""}`
    : "";
  return `<div class="task ${done ? "done" : ""} ${t.priority === "high" ? "high" : ""} mode-${mode}" data-task="${esc(t.id)}">
    <div class="body">
      <button class="title" data-act="expand" data-id="${esc(t.id)}" aria-expanded="${open}">${esc(t.title)} ${t.priority === "high" ? `<span class="pill high">High</span>` : ""} ${mode === "history" ? `<span class="pill ${done ? "done" : ""}">${done ? "Done" : "Pending"}</span>` : ""}</button>
      <div class="meta">${meta}${open ? "" : ` · <span class="linkish">${mode === "onsite" ? "details / add note" : "open"}</span>`}</div>
      ${open ? `<div class="expand">
        ${t.details ? `<div class="details">${esc(t.details)}</div>` : ""}
        <ul class="comments">${cs.map(commentItem).join("") || `<li class="system">No notes yet.</li>`}</ul>
        <form class="comment-form" data-form="comment" data-task="${esc(t.id)}">
          <textarea name="text" placeholder="Add a note: what you saw, measured, replaced…" data-draft="c-${esc(t.id)}" required></textarea>
          <div class="btns"><button class="btn primary small">Add note</button>${manage}</div>
        </form>
      </div>` : ""}
    </div>
    ${toggle}
  </div>`;
}

function commentItem(c) {
  const v = c.visitId ? visitById(c.visitId) : null;
  return `<li class="${c.system ? "system" : ""}">
    <div class="cmeta"><b>${esc(c.authorName)}</b><span>${fmtDateTime(c.createdAt)}</span>${v ? `<span>(visit ${esc(v.date)})</span>` : ""}${c.editedAt ? `<span>(edited)</span>` : ""}
      ${!c.system && canEditComment(c) ? `<button class="btn link" data-act="edit-comment" data-id="${esc(c.id)}">Edit</button><button class="btn link" data-act="delete-comment" data-id="${esc(c.id)}">Delete</button>` : ""}
    </div>
    <div class="ctext">${esc(c.text)}</div></li>`;
}

function sortPending(a, b) {
  const pa = a.priority === "high" ? 0 : 1, pb = b.priority === "high" ? 0 : 1;
  return pa - pb || (a.createdAt || 0) - (b.createdAt || 0);
}
const loadingSite = () => `<div class="boot">Loading ${esc(site()?.name || "")}…</div>`;
const siteDesc = () => (site()?.description ? `<p class="muted small" style="margin:0 2px 10px">${esc(site().description)}</p>` : "");

/* ---------- Off site: plan the work ---------- */
function offsiteView() {
  if (!S.siteLoaded) return loadingSite();
  const s = site();
  const pending = S.tasks.filter((t) => t.status !== "done").sort(sortPending);
  const last = [...S.visits].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.startedAt || 0) - (a.startedAt || 0))[0];
  const v = openVisit();
  return `${siteDesc()}
    ${v ? `<div class="note">A visit is in progress at ${esc(s.name)} (${esc(fmtDay(v.date))}). Tasks you add here show up on site right away.</div>`
        : last ? `<div class="muted small" style="margin:0 2px 10px">Last visit: ${esc(fmtDay(last.date))}${last.crew ? `, ${esc(last.crew)}` : ""}</div>` : ""}
    <section class="card">
      <h2>Add a task for the field</h2>
      <form data-form="add-task">
        <label class="field"><span>Task</span><input type="text" name="title" required placeholder="e.g. Replace LI-7200 desiccant" data-draft="nt-title"></label>
        <label class="field"><span>Details (optional)</span><textarea name="details" placeholder="Parts, tools, context, what to check…" data-draft="nt-details"></textarea></label>
        <div class="row">
          <label class="field shrink"><span>Priority</span><select name="priority" data-draft="nt-prio"><option value="normal">Normal</option><option value="high">High</option></select></label>
          <div class="shrink" style="margin-bottom:10px"><button class="btn primary">Add task</button></div>
        </div>
      </form>
    </section>

    <div class="section-title"><h2>To do at ${esc(s.name)}</h2><span class="count">${pending.length}</span></div>
    ${pending.map((t) => taskCard(t, { mode: "offsite" })).join("") || `<div class="empty">Nothing planned for this site yet.</div>`}`;
}

/* ---------- On site: tick off and log ---------- */
function onsiteView() {
  if (!S.siteLoaded) return loadingSite();
  const s = site();
  const v = openVisit();
  const pending = S.tasks.filter((t) => t.status !== "done").sort(sortPending);
  const doneHere = v ? S.tasks.filter((t) => t.status === "done" && t.doneVisitId === v.id).sort((a, b) => b.doneAt - a.doneAt) : [];
  const vnotes = v ? S.comments.filter((c) => c.visitId === v.id && !c.taskId).sort((a, b) => a.createdAt - b.createdAt) : [];

  const bar = v
    ? `<section class="card visit-bar open">
        <div class="status">Visit in progress: ${esc(fmtDay(v.date))}</div>
        <div class="meta">Crew: ${esc(v.crew || "(not set)")} · started ${fmtDateTime(v.startedAt)} by ${esc(v.startedBy)}</div>
        <div class="btns">
          <button class="btn primary" data-act="end-visit">End visit</button>
          <button class="btn" data-act="show-summary" data-id="${esc(v.id)}">Summary so far</button>
          <button class="btn" data-act="edit-visit" data-id="${esc(v.id)}">Edit date / crew</button>
        </div>
      </section>`
    : `<section class="card visit-bar">
        <h2>Start a visit at ${esc(s?.name)}</h2>
        <form data-form="start-visit">
          <div class="row">
            <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}" required data-draft="sv-date"></label>
            <label class="field"><span>Crew</span><input type="text" name="crew" value="${esc(myName())}" placeholder="Names of people on site" data-draft="sv-crew"></label>
          </div>
          <button class="btn primary">Start visit</button>
        </form>
      </section>`;

  return `${siteDesc()}
    ${bar}
    <div class="section-title"><h2>To do</h2><span class="count">${pending.length}</span></div>
    ${pending.map((t) => taskCard(t, { mode: "onsite" })).join("") || `<div class="empty">Nothing left to do at this site.</div>`}

    ${v ? `<section class="card log-card">
        <h2>Log other work done</h2>
        <form data-form="log-done">
          <label class="field"><span>What was done</span><input type="text" name="title" required placeholder="e.g. Cleaned CNR4 domes" data-draft="ld-title"></label>
          <label class="field"><span>Note (optional)</span><textarea name="note" placeholder="Details, readings, parts used…" data-draft="ld-note"></textarea></label>
          <div class="btns">
            <button class="btn primary" value="done">Log as done</button>
            <button class="btn" value="todo" data-submit="todo">Save as to do for later</button>
          </div>
        </form>
      </section>

      <div class="section-title"><h2>Done during this visit</h2><span class="count">${doneHere.length}</span></div>
      ${doneHere.map((t) => taskCard(t, { mode: "onsite" })).join("") || `<div class="empty">Switch tasks above to Done as you finish them.</div>`}

      <div class="section-title"><h2>Visit notes</h2><span class="count">${vnotes.length}</span></div>
      <section class="card">
        <ul class="comments">${vnotes.map(commentItem).join("") || `<li class="system">General observations for this visit: weather, access, anything not tied to one task.</li>`}</ul>
        <form class="comment-form" data-form="visit-note">
          <textarea name="text" placeholder="Add a general note for this visit" data-draft="vn" required></textarea>
          <div class="btns"><button class="btn primary small">Add note</button></div>
        </form>
      </section>` : `<div class="note">Start the visit above to switch tasks to Done and log other work.</div>`}`;
}

/* ---------- History ---------- */
function historyView() {
  const s = site();
  if (!S.siteLoaded) return `<div class="boot">Loading ${esc(s?.name || "")}…</div>`;
  const sub = `<div class="subtabs" role="tablist">
      <button role="tab" data-act="hist" data-mode="visits" aria-selected="${S.histMode === "visits"}">Visits</button>
      <button role="tab" data-act="hist" data-mode="tasks" aria-selected="${S.histMode === "tasks"}">All tasks</button>
    </div>`;
  if (S.histMode === "tasks") return sub + historyTasks();

  const visits = [...S.visits].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.startedAt || 0) - (a.startedAt || 0));
  const hasOpen = !!openVisit();
  return sub + (visits.map((v) => {
    const st = visitStats(v, S.tasks, S.comments);
    const open = S.openVisits.has(v.id);
    return `<section class="card visit-card">
      <div class="head" data-act="toggle-visit" data-id="${esc(v.id)}">
        <div><h3>${esc(fmtDay(v.date))} ${v.status === "open" ? `<span class="pill open">In progress</span>` : ""}</h3>
          <div class="stats">Crew: ${esc(v.crew || "(not set)")}<br>${st.completed} completed · ${st.added} added · ${st.notes} notes</div></div>
        <button class="btn small" aria-expanded="${open}">${open ? "Hide" : "Summary"}</button>
      </div>
      ${open ? `<pre class="summary">${esc(visitSummary({ site: s, visit: v, tasks: S.tasks, comments: S.comments, format: "text" }))}</pre>
        <div class="btns">
          <button class="btn primary small" data-act="copy-summary" data-id="${esc(v.id)}" data-format="text">Copy text</button>
          <button class="btn small" data-act="copy-summary" data-id="${esc(v.id)}" data-format="md">Copy Markdown</button>
          <button class="btn small" data-act="edit-visit" data-id="${esc(v.id)}">Edit date / crew</button>
          ${v.status === "closed" && !hasOpen ? `<button class="btn small" data-act="reopen-visit" data-id="${esc(v.id)}">Reopen</button>` : ""}
          ${isAdmin() ? `<button class="btn danger small" data-act="delete-visit" data-id="${esc(v.id)}">Delete visit</button>` : ""}
        </div>` : ""}
    </section>`;
  }).join("") || `<div class="empty">No visits recorded at ${esc(s?.name)} yet.</div>`);
}

function historyTasks() {
  const q = S.search.trim().toLowerCase();
  const list = S.tasks
    .filter((t) => S.statusFilter === "all" || (S.statusFilter === "done" ? t.status === "done" : t.status !== "done"))
    .filter((t) => !q || (t.title + " " + (t.details || "") + " " + commentsFor(t.id).map((c) => c.text).join(" ")).toLowerCase().includes(q))
    .sort((a, b) => (b.doneAt || b.createdAt || 0) - (a.doneAt || a.createdAt || 0));
  return `<div class="filters">
      <input type="search" placeholder="Search tasks and notes" value="${esc(S.search)}" data-act="search" data-draft="h-search">
      <select data-act="status-filter" aria-label="Status">
        <option value="all" ${S.statusFilter === "all" ? "selected" : ""}>All</option>
        <option value="pending" ${S.statusFilter === "pending" ? "selected" : ""}>Pending</option>
        <option value="done" ${S.statusFilter === "done" ? "selected" : ""}>Done</option>
      </select>
      <button class="btn" data-act="export-csv">Export CSV</button>
    </div>
    <div class="muted small" style="margin:0 2px 8px">${list.length} task${list.length === 1 ? "" : "s"}</div>
    ${list.map((t) => taskCard(t, { mode: "history" })).join("") || `<div class="empty">No tasks match.</div>`}`;
}

/* ---------- Admin ---------- */
function adminView() {
  const members = [...S.members].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return `<section class="card">
      <h2>Sites</h2>
      ${S.sites.map((s) => `<div class="list-row">
          <div class="grow"><b>${esc(s.name)}</b>${s.description ? `<div class="muted small">${esc(s.description)}</div>` : ""}</div>
          <button class="btn small" data-act="edit-site" data-id="${esc(s.id)}">Edit</button>
          <button class="btn danger small" data-act="delete-site" data-id="${esc(s.id)}">Delete</button>
        </div>`).join("") || `<div class="empty">No sites yet.</div>`}
      <form data-form="add-site" style="margin-top:12px">
        <div class="row">
          <label class="field"><span>New site name</span><input type="text" name="name" required placeholder="e.g. UQAM_4" data-draft="ns-name"></label>
          <label class="field"><span>Description (optional)</span><input type="text" name="description" placeholder="Location, access, notes" data-draft="ns-desc"></label>
          <div class="shrink" style="margin-bottom:10px"><button class="btn primary">Add site</button></div>
        </div>
      </form>
    </section>

    <section class="card">
      <h2>Team</h2>
      <div class="note">After you add someone, they open this app, choose <b>Create account</b> with that same email, and confirm the email they receive. Members can add tasks, tick them off and write notes. Admins can also manage sites, the team and delete records.</div>
      ${members.map((m) => `<div class="list-row">
          <div class="grow"><b>${esc(m.name || "")}</b> <span class="muted small">${esc(m.email)}</span></div>
          <select data-act="role" data-id="${esc(m.id)}" ${m.id === S.user.email ? "disabled" : ""} aria-label="Role">
            <option value="member" ${m.role !== "admin" ? "selected" : ""}>Member</option>
            <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
          <button class="btn small" data-act="rename-member" data-id="${esc(m.id)}">Rename</button>
          ${m.id !== S.user.email ? `<button class="btn danger small" data-act="remove-member" data-id="${esc(m.id)}">Remove</button>` : ""}
        </div>`).join("")}
      <form data-form="add-member" style="margin-top:12px">
        <div class="row">
          <label class="field"><span>Email</span><input type="email" name="email" required data-draft="nm-email"></label>
          <label class="field"><span>Name</span><input type="text" name="name" required data-draft="nm-name"></label>
          <label class="field shrink"><span>Role</span><select name="role" data-draft="nm-role"><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <div class="shrink" style="margin-bottom:10px"><button class="btn primary">Add person</button></div>
        </div>
      </form>
    </section>`;
}

/* =====================================================================
   Actions
   ===================================================================== */
function startVisit(date, crew) {
  const id = S.B.newId(`${sitePath()}/visits`);
  w(S.B.set(`${sitePath()}/visits/${id}`, {
    date: date || todayStr(), crew: crew || myName(), status: "open",
    startedAt: now(), startedBy: myName(), startedByEmail: S.user.email,
  }));
  return id;
}

function addComment({ taskId = null, visitId = null, text, system = false }) {
  const id = S.B.newId(`${sitePath()}/comments`);
  return w(S.B.set(`${sitePath()}/comments/${id}`, {
    taskId, visitId, text, system, createdAt: now(), authorName: myName(), authorEmail: S.user.email,
  }));
}

async function toggleTask(id, checked, inputEl) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return;
  const base = `${sitePath()}/tasks/${id}`;
  if (checked) {
    let v = openVisit();
    if (!v) {
      inputEl.checked = false;
      const ok = await confirmBox("Start a visit?", "Tasks are checked off as part of a visit, so they show up in that visit's summary. Start today's visit now?", "Start visit");
      if (!ok) return;
      startVisit(todayStr(), myName());
      // the new visit arrives through the listener; wait for it briefly
      for (let i = 0; i < 40 && !openVisit(); i++) await new Promise((r) => setTimeout(r, 50));
      v = openVisit();
      if (!v) return toast("Could not start the visit.", true);
    }
    w(S.B.update(base, { status: "done", doneAt: now(), doneBy: myName(), doneByEmail: S.user.email, doneVisitId: v.id }));
  } else {
    const wasVisit = t.doneVisitId ? visitById(t.doneVisitId) : null;
    w(S.B.update(base, { status: "pending", doneAt: null, doneBy: null, doneByEmail: null, doneVisitId: null }));
    addComment({ taskId: id, visitId: openVisit()?.id || null, system: true,
      text: `Marked not done again (had been completed ${fmtDate(t.doneAt)} by ${t.doneBy}${wasVisit ? `, visit ${wasVisit.date}` : ""}).` });
  }
}

function showSummary(visitId, { ending = false } = {}) {
  const v = visitById(visitId);
  if (!v) return;
  const text = visitSummary({ site: site(), visit: v, tasks: S.tasks, comments: S.comments, format: "text", endingNow: ending });
  const actions = ending
    ? [{ label: "Cancel", value: "cancel" }, { label: "Copy text", value: "copy-text" }, { label: "End visit", value: "end", cls: "primary" }]
    : [{ label: "Close", value: "close" }, { label: "Copy Markdown", value: "copy-md" }, { label: "Copy text", value: "copy-text", cls: "primary" }];
  modal({
    title: ending ? "End visit: review summary" : "Visit summary",
    body: `<pre class="summary">${esc(text)}</pre>`,
    actions,
  }).then(({ action }) => {
    if (action === "copy-text") { copyText(text); if (ending) showSummary(visitId, { ending }); }
    if (action === "copy-md") copyText(visitSummary({ site: site(), visit: v, tasks: S.tasks, comments: S.comments, format: "md" }));
    if (action === "end") {
      w(S.B.update(`${sitePath()}/visits/${v.id}`, { status: "closed", endedAt: now(), endedBy: myName() }));
      toast("Visit closed. Its summary is in History.");
    }
  });
}

async function deleteSite(id) {
  const s = S.sites.find((x) => x.id === id);
  if (!s) return;
  const { action, values } = await modal({
    title: `Delete ${s.name}?`,
    body: `<p>This permanently deletes the site with <b>all its tasks, notes and visits</b>. It cannot be undone. Consider exporting its tasks to CSV first (History, All tasks).</p>
      <label class="field"><span>Type the site name to confirm</span><input type="text" name="confirm" autocomplete="off"></label>`,
    actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label: "Delete site", value: "ok", cls: "danger" }],
  });
  if (action !== "ok") return;
  if (values.confirm.trim() !== s.name) return toast("Name did not match. Nothing was deleted.", true);
  try {
    const p = `sites/${id}`;
    if (S.siteId === id) selectSite(null);
    await S.B.removeCol(`${p}/tasks`);
    await S.B.removeCol(`${p}/comments`);
    await S.B.removeCol(`${p}/visits`);
    await S.B.remove(p);
    toast(`${s.name} deleted`);
  } catch (e) { showErr(e); }
}

/* =====================================================================
   Events
   ===================================================================== */
async function onClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
  const act = el.dataset.act, id = el.dataset.id;
  const B = S.B;

  switch (act) {
    case "auth-mode": S.authMode = el.dataset.mode; S.authError = ""; return renderAuth();
    case "forgot": {
      const email = $('[name="email"]')?.value.trim();
      if (!email) { S.authError = "Type your email above first, then press Forgot password."; return renderAuth(); }
      try { await B.resetPassword(email); toast("Password reset email sent (check spam too)."); } catch (err) { S.authError = authMsg(err); renderAuth(); }
      return;
    }
    case "verified": {
      const u = await B.refreshUser().catch(showErr);
      if (u?.emailVerified) onUser(u); else toast("Not confirmed yet. Open the link in the email first.", true);
      return;
    }
    case "resend": return B.resendVerification().then(() => toast("Email sent again.")).catch(showErr);
    case "signout": resetData(); return B.signOut();
    case "view": S.view = el.dataset.view; lsSet("fieldlog-view", S.view); window.scrollTo(0, 0); return renderApp();
    case "hist": S.histMode = el.dataset.mode; return renderApp();
    case "expand": S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); return renderApp();
    case "toggle-visit": S.openVisits.has(id) ? S.openVisits.delete(id) : S.openVisits.add(id); return renderApp();
    case "end-visit": { const v = openVisit(); if (v) showSummary(v.id, { ending: true }); return; }
    case "show-summary": return showSummary(id);
    case "copy-summary": {
      const v = visitById(id);
      return copyText(visitSummary({ site: site(), visit: v, tasks: S.tasks, comments: S.comments, format: el.dataset.format }));
    }
    case "edit-visit": {
      const v = visitById(id);
      const { action, values } = await modal({
        title: "Edit visit",
        body: `<label class="field"><span>Date</span><input type="date" name="date" value="${esc(v.date)}" required></label>
               <label class="field"><span>Crew</span><input type="text" name="crew" value="${esc(v.crew || "")}"></label>`,
        actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label: "Save", value: "ok", cls: "primary" }],
      });
      if (action === "ok") w(B.update(`${sitePath()}/visits/${id}`, { date: values.date, crew: values.crew.trim() }));
      return;
    }
    case "reopen-visit":
      if (openVisit()) return toast("Another visit is already in progress.", true);
      w(B.update(`${sitePath()}/visits/${id}`, { status: "open", endedAt: null }));
      toast("Visit reopened. Continue it in On site.");
      return;
    case "delete-visit": {
      if (!(await confirmBox("Delete this visit?", "The visit record is removed. Tasks and notes stay in the task history but lose the link to this visit.", "Delete", "danger"))) return;
      S.openVisits.delete(id);
      w(B.remove(`${sitePath()}/visits/${id}`));
      return;
    }
    case "edit-task": {
      const t = S.tasks.find((x) => x.id === id);
      const { action, values } = await modal({
        title: "Edit task",
        body: `<label class="field"><span>Task</span><input type="text" name="title" value="${esc(t.title)}" required></label>
               <label class="field"><span>Details</span><textarea name="details">${esc(t.details || "")}</textarea></label>
               <label class="field"><span>Priority</span><select name="priority"><option value="normal">Normal</option><option value="high" ${t.priority === "high" ? "selected" : ""}>High</option></select></label>`,
        actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label: "Save", value: "ok", cls: "primary" }],
      });
      if (action === "ok") w(B.update(`${sitePath()}/tasks/${id}`, { title: values.title.trim(), details: values.details.trim(), priority: values.priority, updatedAt: now(), updatedBy: myName() }));
      return;
    }
    case "delete-task": {
      const t = S.tasks.find((x) => x.id === id);
      if (!(await confirmBox("Delete task?", `"${esc(t.title)}" and its notes will be permanently deleted.`, "Delete", "danger"))) return;
      commentsFor(id).forEach((c) => w(B.remove(`${sitePath()}/comments/${c.id}`)));
      w(B.remove(`${sitePath()}/tasks/${id}`));
      return;
    }
    case "edit-comment": {
      const c = S.comments.find((x) => x.id === id);
      const { action, values } = await modal({
        title: "Edit note",
        body: `<label class="field"><span>Note</span><textarea name="text" required rows="5">${esc(c.text)}</textarea></label>`,
        actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label: "Save", value: "ok", cls: "primary" }],
      });
      if (action === "ok" && values.text.trim()) w(B.update(`${sitePath()}/comments/${id}`, { text: values.text.trim(), editedAt: now() }));
      return;
    }
    case "delete-comment":
      if (await confirmBox("Delete note?", "This note will be permanently deleted.", "Delete", "danger")) w(B.remove(`${sitePath()}/comments/${id}`));
      return;
    case "export-csv": {
      const csv = tasksCsv({ site: site(), tasks: S.tasks, comments: S.comments, visits: S.visits });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      a.download = `${site().name}_tasks_${todayStr()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    case "edit-site": {
      const s = S.sites.find((x) => x.id === id);
      const { action, values } = await modal({
        title: "Edit site",
        body: `<label class="field"><span>Name</span><input type="text" name="name" value="${esc(s.name)}" required></label>
               <label class="field"><span>Description</span><textarea name="description">${esc(s.description || "")}</textarea></label>`,
        actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label: "Save", value: "ok", cls: "primary" }],
      });
      if (action === "ok") w(B.update(`sites/${id}`, { name: values.name.trim(), description: values.description.trim() }));
      return;
    }
    case "delete-site": return deleteSite(id);
    case "rename-member": {
      const m = S.members.find((x) => x.id === id);
      const { action, values } = await modal({
        title: "Rename",
        body: `<label class="field"><span>Name for ${esc(m.email)}</span><input type="text" name="name" value="${esc(m.name || "")}" required></label>`,
        actions: [{ label: "Cancel", value: "cancel", novalidate: true }, { label: "Save", value: "ok", cls: "primary" }],
      });
      if (action === "ok") w(B.update(`members/${id}`, { name: values.name.trim() }));
      return;
    }
    case "remove-member": {
      const m = S.members.find((x) => x.id === id);
      if (await confirmBox("Remove person?", `${esc(m.name || m.email)} will lose access. Everything they wrote stays in the log.`, "Remove", "danger")) w(B.remove(`members/${id}`));
      return;
    }
  }
}

function onChange(e) {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === "site") { selectSite(el.value); return; }
  if (act === "toggle") { toggleTask(el.dataset.id, el.checked, el); return; }
  if (act === "status-filter") { S.statusFilter = el.value; renderApp(); return; }
  if (act === "role") { w(S.B.update(`members/${el.dataset.id}`, { role: el.value })); return; }
}

let searchTimer;
function onInput(e) {
  if (e.target.dataset?.act === "search") {
    S.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderApp, 200);
  }
}

function authMsg(err) {
  const c = err?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("email-already-in-use")) return "An account with this email already exists. Sign in instead (or use Forgot password).";
  if (c.includes("weak-password")) return "Password is too weak: use at least 6 characters.";
  if (c.includes("invalid-email")) return "That email address does not look valid.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  if (c.includes("network")) return "No connection. Check your internet and try again.";
  if (c.includes("operation-not-allowed")) return "Email/password sign-in is not enabled in Firebase yet (see README).";
  return err?.message || String(err);
}

async function onSubmit(e) {
  const form = e.target;
  if (form.id === "modalForm") return; // handled by <dialog>
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form).entries());
  const B = S.B;

  if (form.id === "authForm") {
    S.authError = "";
    const email = fd.email.trim().toLowerCase();
    try {
      if (S.authMode === "signup") {
        if (fd.password !== fd.password2) { S.authError = "Passwords do not match."; return renderAuth(); }
        await B.signUp(email, fd.password);
      } else {
        await B.signIn(email, fd.password);
      }
    } catch (err) { S.authError = authMsg(err); renderAuth(); }
    return;
  }

  const clear = () => { form.reset(); $$("[data-draft]", form).forEach((el) => { if (el.type === "checkbox") el.checked = false; }); };

  switch (form.dataset.form) {
    case "start-visit": {
      if (openVisit()) return toast("A visit is already in progress.", true);
      startVisit(fd.date, fd.crew.trim());
      return;
    }
    case "add-task": { // Off site planning
      const title = fd.title.trim();
      if (!title) return;
      const id = B.newId(`${sitePath()}/tasks`);
      w(B.set(`${sitePath()}/tasks/${id}`, {
        title, details: (fd.details || "").trim(), priority: fd.priority || "normal", status: "pending",
        createdAt: now(), createdBy: myName(), createdByEmail: S.user.email, createdVisitId: null,
        doneAt: null, doneBy: null, doneByEmail: null, doneVisitId: null,
      }));
      clear();
      toast("Task added");
      return;
    }
    case "log-done": { // On site: extra work done, or a new issue for later
      const title = fd.title.trim();
      const v = openVisit();
      if (!title || !v) return;
      const doneNow = e.submitter?.value !== "todo";
      const id = B.newId(`${sitePath()}/tasks`);
      w(B.set(`${sitePath()}/tasks/${id}`, {
        title, details: "", priority: "normal", status: doneNow ? "done" : "pending",
        createdAt: now(), createdBy: myName(), createdByEmail: S.user.email, createdVisitId: v.id,
        doneAt: doneNow ? now() : null, doneBy: doneNow ? myName() : null, doneByEmail: doneNow ? S.user.email : null, doneVisitId: doneNow ? v.id : null,
      }));
      const note = (fd.note || "").trim();
      if (note) addComment({ taskId: id, visitId: v.id, text: note });
      clear();
      toast(doneNow ? "Logged as done" : "Saved as to do");
      return;
    }
    case "comment": {
      const text = (fd.text || "").trim();
      if (!text) return;
      addComment({ taskId: form.dataset.task, visitId: openVisit()?.id || null, text });
      form.reset();
      return;
    }
    case "visit-note": {
      const text = (fd.text || "").trim();
      const v = openVisit();
      if (!text || !v) return;
      addComment({ taskId: null, visitId: v.id, text });
      form.reset();
      return;
    }
    case "add-site": {
      const name = fd.name.trim();
      if (!name) return;
      if (S.sites.some((s) => s.name.toLowerCase() === name.toLowerCase())) return toast("A site with that name already exists.", true);
      const id = B.newId("sites");
      w(B.set(`sites/${id}`, { name, description: (fd.description || "").trim(), createdAt: now(), createdBy: myName() }));
      clear();
      toast(`Site ${name} added`);
      if (!S.siteId) selectSite(id);
      return;
    }
    case "add-member": {
      const email = fd.email.trim().toLowerCase();
      if (S.members.some((m) => m.id === email)) return toast("That person is already on the team.", true);
      w(B.set(`members/${email}`, { email, name: fd.name.trim(), role: fd.role, addedAt: now(), addedBy: myName() }));
      clear();
      toast(`${fd.name.trim()} added. They can now create their account.`);
      return;
    }
  }
}

boot();
