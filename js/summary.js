// Builds the per-visit summary (plain text or Markdown) and the CSV export.

const time = (ms) => (ms ? new Date(ms).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const longDay = (ymd) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};
const byTime = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

function collect(visit, tasks, comments, endingNow = false) {
  const vComments = comments.filter((c) => c.visitId === visit.id && !c.system).sort(byTime);
  const notesFor = (taskId) => vComments.filter((c) => c.taskId === taskId);
  const completed = tasks.filter((t) => t.status === "done" && t.doneVisitId === visit.id).sort((a, b) => a.doneAt - b.doneAt);
  const added = tasks.filter((t) => t.createdVisitId === visit.id && !(t.status === "done" && t.doneVisitId === visit.id)).sort(byTime);
  const shown = new Set([...completed, ...added].map((t) => t.id));
  const progressed = tasks.filter((t) => !shown.has(t.id) && notesFor(t.id).length).sort(byTime);
  const general = vComments.filter((c) => !c.taskId);

  // Tasks that were still open when the visit ended (or now, if it is still running).
  const end = visit.status === "open" || endingNow ? Date.now() : visit.endedAt || Date.now();
  const doneHere = new Set(completed.map((t) => t.id));
  const stillPending = tasks.filter((t) =>
    (t.createdAt || 0) <= end &&
    !doneHere.has(t.id) &&
    !(t.status === "done" && (t.doneAt || 0) <= end)
  ).sort((a, b) => (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) || byTime(a, b));

  return { completed, added, progressed, general, stillPending, notesFor, vComments };
}

export function visitStats(visit, tasks, comments) {
  const c = collect(visit, tasks, comments);
  return { completed: c.completed.length, added: c.added.length, notes: c.vComments.length };
}

export function visitSummary({ site, visit, tasks, comments, format = "text", endingNow = false }) {
  const md = format === "md";
  const c = collect(visit, tasks, comments, endingNow);
  const L = [];
  const heading = (t, n) => {
    L.push("");
    const label = n === undefined ? t : `${t} (${n})`;
    L.push(md ? `### ${label}` : label.toUpperCase());
  };
  const prio = (t) => (t.priority === "high" ? (md ? " **[high priority]**" : " [high priority]") : "");
  const title = (t) => (md ? `**${t.title}**` : t.title);
  const noteLines = (list, indent) => list.forEach((n) => {
    const who = `${n.authorName}, ${time(n.createdAt)}`;
    const text = n.text.replace(/\n+/g, " / ");
    L.push(md ? `${indent}- *${who}:* ${text}` : `${indent}${who}: ${text}`);
  });
  const taskLine = (t, { details = false } = {}) => {
    L.push(`- ${title(t)}${prio(t)}`);
    if (details && t.details) L.push(md ? `  - ${t.details.replace(/\n+/g, " / ")}` : `    ${t.details.replace(/\n+/g, " / ")}`);
    noteLines(c.notesFor(t.id), md ? "  " : "    ");
  };

  const siteName = site?.name || "Site";
  L.push(md ? `## ${siteName}: field visit, ${longDay(visit.date)}` : `${siteName}: field visit, ${longDay(visit.date)}`);
  L.push(md ? `**Crew:** ${visit.crew || "(not set)"}  ` : `Crew: ${visit.crew || "(not set)"}`);
  const endTxt = visit.status === "open" && !endingNow ? "in progress" : time(endingNow ? Date.now() : visit.endedAt);
  L.push(md ? `**On site:** ${time(visit.startedAt)} to ${endTxt}` : `On site: ${time(visit.startedAt)} to ${endTxt}`);

  heading("Work completed", c.completed.length);
  if (c.completed.length) c.completed.forEach((t) => taskLine(t)); else L.push("- None");

  if (c.progressed.length) {
    heading("Worked on, not finished", c.progressed.length);
    c.progressed.forEach((t) => taskLine(t));
  }

  if (c.added.length) {
    heading("New issues logged, still to do", c.added.length);
    c.added.forEach((t) => taskLine(t, { details: true }));
  }

  if (c.general.length) {
    heading("Visit notes");
    noteLines(c.general, md ? "" : "- ");
  }

  heading("Open tasks at this site after the visit", c.stillPending.length);
  if (c.stillPending.length) c.stillPending.forEach((t) => L.push(`- ${t.title}${prio(t)}`)); else L.push("- None");

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function tasksCsv({ site, tasks, comments, visits }) {
  const vdate = (id) => visits.find((v) => v.id === id)?.date || "";
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const iso = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "");
  const rows = [["site", "task", "details", "priority", "status", "added", "added_by", "done", "done_by", "done_visit", "notes"]];
  [...tasks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((t) => {
    const notes = comments.filter((c) => c.taskId === t.id).sort(byTime)
      .map((c) => `[${iso(c.createdAt)} ${c.authorName}] ${c.text}`).join("\n");
    rows.push([site?.name, t.title, t.details, t.priority, t.status, iso(t.createdAt), t.createdBy, iso(t.doneAt), t.doneBy, vdate(t.doneVisitId), notes]);
  });
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}
