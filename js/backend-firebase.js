// Real backend: Firebase Authentication + Cloud Firestore, loaded from Google's CDN.
const V = "12.6.0";
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

export async function createBackend(config) {
  const [appM, authM, fsM] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js"),
  ]);
  const app = appM.initializeApp(config);
  const auth = authM.getAuth(app);
  let db;
  try {
    // Local cache so the app keeps working through short signal drops.
    db = fsM.initializeFirestore(app, {
      localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
    });
  } catch (e) {
    db = fsM.getFirestore(app);
  }

  const ref = (path) => fsM.doc(db, path);
  const col = (path) => fsM.collection(db, path);
  const toUser = (u) => (u ? { email: (u.email || "").toLowerCase(), emailVerified: u.emailVerified } : null);

  return {
    demo: false,

    // ---------- auth ----------
    onAuth(cb) { return authM.onAuthStateChanged(auth, (u) => cb(toUser(u))); },
    async signIn(email, pw) { await authM.signInWithEmailAndPassword(auth, email, pw); },
    async signUp(email, pw) {
      const cred = await authM.createUserWithEmailAndPassword(auth, email, pw);
      await authM.sendEmailVerification(cred.user);
    },
    async resendVerification() { if (auth.currentUser) await authM.sendEmailVerification(auth.currentUser); },
    async refreshUser() {
      if (!auth.currentUser) return null;
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true); // so security rules see email_verified
      return toUser(auth.currentUser);
    },
    async resetPassword(email) { await authM.sendPasswordResetEmail(auth, email); },
    async signOut() { await authM.signOut(auth); },

    // ---------- database ----------
    watchCol(path, cb, err) {
      return fsM.onSnapshot(col(path),
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => err && err(e));
    },
    watchDoc(path, cb, err) {
      return fsM.onSnapshot(ref(path),
        (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
        (e) => err && err(e));
    },
    newId(colPath) { return fsM.doc(col(colPath)).id; },
    async set(path, data) { await fsM.setDoc(ref(path), data); },
    async createStrict(path, data) {
      // Transactions only commit on the server, so a rejected write never appears locally.
      await fsM.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref(path));
        if (!snap.exists()) tx.set(ref(path), data);
      });
    },
    async update(path, data) { await fsM.updateDoc(ref(path), data); },
    async remove(path) { await fsM.deleteDoc(ref(path)); },
    async removeCol(path) {
      const snap = await fsM.getDocs(col(path));
      let batch = fsM.writeBatch(db), n = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref);
        if (++n === 400) { await batch.commit(); batch = fsM.writeBatch(db); n = 0; }
      }
      if (n) await batch.commit();
    },
  };
}
