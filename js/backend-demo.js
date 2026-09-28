// Demo backend: same interface as backend-firebase.js, but everything lives in
// this browser's localStorage. Used when no Firebase config is set (or ?demo in the URL).
// It mimics the security rules roughly so the demo behaves like the real thing.

const KEY = "fieldlog-demo-db-v1";
const UKEY = "fieldlog-demo-users-v1";
const SKEY = "fieldlog-demo-session-v1";

function load(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export async function createBackend(_config, { adminEmail }) {
  let docs = load(KEY, {});          // { "a/b/c/d": {...data} }
  let users = load(UKEY, {});        // { email: password }
  let session = load(SKEY, null);    // email or null
  const authCbs = new Set();
  const watchers = new Set();        // { kind, path, cb, err }

  const owner = (adminEmail || "").toLowerCase();
  const me = () => session;
  const memberOf = (e) => docs["members/" + e];
  const canUse = () => !!me() && (me() === owner || !!memberOf(me()));
  const isAdmin = () => !!me() && (me() === owner || memberOf(me())?.role === "admin");
  const denied = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

  const parentOf = (p) => p.split("/").slice(0, -1).join("/");
  const idOf = (p) => p.split("/").pop();

  function colDocs(colPath) {
    const depth = colPath.split("/").length + 1;
    return Object.keys(docs)
      .filter((p) => parentOf(p) === colPath && p.split("/").length === depth)
      .map((p) => ({ id: idOf(p), ...structuredClone(docs[p]) }));
  }

  function canRead(path) {
    if (canUse()) return true;
    return me() && path === "members/" + me();
  }
  function canWrite(path) {
    const parts = path.split("/");
    if (parts[0] === "members" || parts.length === 2) return isAdmin();
    return canUse();
  }

  function fire() {
    for (const w of watchers) emit(w);
  }
  function emit(w) {
    if (!canRead(w.path)) { w.err && w.err(denied()); return; }
    if (w.kind === "col") w.cb(colDocs(w.path));
    else w.cb(docs[w.path] ? { id: idOf(w.path), ...structuredClone(docs[w.path]) } : null);
  }
  function commit() { save(KEY, docs); queueMicrotask(fire); }

  window.addEventListener("storage", (e) => {
    if (e.key === KEY) { docs = load(KEY, {}); fire(); }
  });

  const user = () => (me() ? { email: me(), emailVerified: true } : null);
  const setSession = (e) => { session = e; save(SKEY, e); authCbs.forEach((cb) => cb(user())); };
  const authErr = (code) => Object.assign(new Error(code), { code });

  return {
    demo: true,

    onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(user()), 0); return () => authCbs.delete(cb); },
    async signIn(email, pw) {
      email = email.trim().toLowerCase();
      if (!users[email]) throw authErr("auth/invalid-credential");
      if (users[email] !== pw) throw authErr("auth/invalid-credential");
      setSession(email);
    },
    async signUp(email, pw) {
      email = email.trim().toLowerCase();
      if (users[email]) throw authErr("auth/email-already-in-use");
      if ((pw || "").length < 6) throw authErr("auth/weak-password");
      users[email] = pw; save(UKEY, users); setSession(email);
    },
    async resendVerification() {},
    async refreshUser() { return user(); },
    async resetPassword() {},
    async signOut() { setSession(null); },

    watchCol(path, cb, err) {
      const w = { kind: "col", path, cb, err }; watchers.add(w); setTimeout(() => emit(w), 0);
      return () => watchers.delete(w);
    },
    watchDoc(path, cb, err) {
      const w = { kind: "doc", path, cb, err }; watchers.add(w); setTimeout(() => emit(w), 0);
      return () => watchers.delete(w);
    },
    newId() { return Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); },
    async set(path, data) {
      // Owner may create their own member record, like in the real rules.
      if (!canWrite(path)) throw denied();
      docs[path] = structuredClone(data); commit();
    },
    async createStrict(path, data) {
      if (!canWrite(path)) throw denied();
      if (!docs[path]) { docs[path] = structuredClone(data); commit(); }
    },
    async update(path, data) {
      if (!canWrite(path)) throw denied();
      if (!docs[path]) throw Object.assign(new Error("No document to update"), { code: "not-found" });
      docs[path] = { ...docs[path], ...structuredClone(data) }; commit();
    },
    async remove(path) {
      if (path.split("/").length > 2 && !isAdmin()) {
        const d = docs[path];
        const mine = d && (d.authorEmail === me() || (d.createdByEmail === me() && d.status === "pending"));
        if (!mine) throw denied();
      } else if (!canWrite(path)) throw denied();
      delete docs[path]; commit();
    },
    async removeCol(path) {
      if (!isAdmin()) throw denied();
      for (const p of Object.keys(docs)) if (parentOf(p) === path) delete docs[p];
      commit();
    },
  };
}
