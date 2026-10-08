/* Cadência — nuvem: login com Google + sincronização via Firebase (Auth + Firestore).
 *
 * Como encaixa no app:
 *   - o app chama window.__cadMount(el) dentro de Ajustes e window.__cadChip(el) no topo da tela Hoje;
 *   - a cada salvamento local o app dispara o evento "cadencia:save" (detail = JSON do estado);
 *   - quando terminou de carregar, o app expõe window.__cad = { get(), apply(json) } e dispara "cadencia:ready".
 *
 * Modelo de dados no Firestore:
 *   users/{uid}                 { data: "<JSON do app>", updatedAt, device, v }
 *   users/{uid}/backups/{dia}   { data, at }   — uma cópia por dia, guarda as 30 mais recentes
 *
 * A lógica de decisão (enviar / baixar / mesclar / perguntar) fica em ./sync-core.js, sem Firebase nem DOM.
 * Build: `npm run build` gera ../../cloud.js (bundle IIFE com o Firebase embutido).
 */
import { initializeApp } from "firebase/app";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, connectAuthEmulator, signInWithCredential,
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, setDoc, onSnapshot, serverTimestamp, collection, getDocs, deleteDoc, connectFirestoreEmulator,
} from "firebase/firestore";
import { summary, merge, decide } from "./sync-core.js";

const APP_KEY = "cadencia:v1";
const META_KEY = "cadencia:cloud";
const DEVICE_KEY = "cadencia:device";
const WELCOME_KEY = "cadencia:welcome";
const KEEP_BACKUPS = 30;
const C = { bg: "#101119", card: "#1A1C26", card2: "#232632", line: "#2D3040", text: "#EEF0F6", dim: "#8B90A5", dim2: "#5C6178",
  mint: "#5FE3B4", lilac: "#A492FF", coral: "#FF8E7A", amber: "#FFC85C" };

/* ── utilidades ─────────────────────────────────────────────── */
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const readJSON = (k, fb) => { try { return JSON.parse(ls.get(k)) ?? fb; } catch { return fb; } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hhmm = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
let deviceId = ls.get(DEVICE_KEY);
if (!deviceId) { deviceId = "d" + Math.random().toString(36).slice(2, 10); ls.set(DEVICE_KEY, deviceId); }

let meta = readJSON(META_KEY, {});
const saveMeta = () => ls.set(META_KEY, JSON.stringify(meta));
const setBase = (uid, json) => { meta = { ...meta, uid, base: json, at: Date.now() }; saveMeta(); };

/* ── ponte com o app ────────────────────────────────────────── */
let appReady = !!window.__cad;
const whenReady = [];
window.addEventListener("cadencia:ready", () => { appReady = true; whenReady.splice(0).forEach((f) => f()); });
const onReady = (f) => (appReady ? f() : whenReady.push(f));
const localJson = () => (window.__cad && window.__cad.get()) || ls.get(APP_KEY);
const applyToApp = (json) => (window.__cad ? window.__cad.apply(json) : json);

/* ── estado da nuvem ────────────────────────────────────────── */
const cfg = window.CADENCIA_FIREBASE;
const configured = !!(cfg && cfg.apiKey && cfg.projectId && !/COLE|SEU_|YOUR_/i.test(cfg.apiKey));
const S = { status: configured ? "signedout" : "off", user: null, lastSync: meta.at || null, error: "", reconciled: false };
const listeners = new Set();
const setS = (patch) => { Object.assign(S, patch); listeners.forEach((f) => f()); };

let auth, db, unsubDoc = null, pushTimer = null;

if (configured) {
  try {
    const app = initializeApp(cfg);
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
    auth.languageCode = "pt";
    let cache;
    try { cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() }); } catch { cache = memoryLocalCache(); }
    db = initializeFirestore(app, { localCache: cache });
    if (cfg.emulator) {                                       // só para testes locais (firebase emulators:start)
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      window.__cadTestLogin = (email) => signInWithCredential(auth, GoogleAuthProvider.credential(
        JSON.stringify({ sub: email, email, email_verified: true, name: email.split("@")[0] })));
    }
    getRedirectResult(auth).catch((e) => setS({ error: friendly(e) }));
    onAuthStateChanged(auth, handleUser);
  } catch (e) {
    console.error("[Cadência] Firebase não iniciou:", e);
    setS({ status: "error", error: "Não foi possível iniciar a nuvem." });
  }
}

function friendly(e) {
  const c = (e && e.code) || "";
  if (c.includes("unauthorized-domain")) return "Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains).";
  if (c.includes("network")) return "Sem conexão com a internet.";
  if (c.includes("permission-denied")) return "Acesso negado pelas regras do Firestore.";
  if (c.includes("operation-not-allowed")) return "Login com Google não está ativado no Firebase.";
  return (e && e.message) || "Algo deu errado.";
}

function handleUser(user) {
  if (unsubDoc) { unsubDoc(); unsubDoc = null; }
  clearTimeout(pushTimer); pushTimer = null;
  if (!user) { setS({ user: null, status: "signedout", reconciled: false }); return; }
  setS({ user, status: navigator.onLine ? "syncing" : "offline", reconciled: false, error: "" });
  const ref = doc(db, "users", user.uid);
  unsubDoc = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    if (snap.metadata.hasPendingWrites) return;              // eco da nossa própria escrita
    const known = meta.uid === user.uid;
    if (snap.metadata.fromCache && !(known && S.reconciled)) {
      if (!navigator.onLine) setS({ status: "offline" });
      return;                                                 // primeira conciliação só com dado do servidor
    }
    const cloud = snap.exists() ? snap.data().data : null;
    onReady(() => reconcile(user, cloud));
  }, (e) => setS({ status: "error", error: friendly(e) }));
}

async function reconcile(user, cloud) {
  if (!S.user || S.user.uid !== user.uid) return;
  const local = localJson();
  const known = meta.uid === user.uid;
  const action = decide(local, cloud, known ? meta.base : undefined);

  if (action === "noop") {
    if (cloud != null) setBase(user.uid, cloud);
    setS({ reconciled: true, status: "synced", lastSync: Date.now() });
    return;
  }
  if (action === "push") return push(local, true);
  if (action === "pull") {
    const msg = !known ? "Seus dados foram baixados da nuvem" : S.reconciled ? "Atualizado de outro aparelho" : "";
    return pull(cloud, msg);
  }
  if (action === "merge") {
    push(applyToApp(merge(cloud, local)), true);
    toast("Alterações dos dois aparelhos combinadas");
    return;
  }
  // "ask": primeiro login deste aparelho nesta conta e há trilhas dos dois lados
  const choice = await askConflict(local, cloud);
  if (choice === "cloud") pull(cloud, "Usando os dados da nuvem");
  else if (choice === "local") { push(local, true); toast("Dados deste aparelho enviados"); }
  else { const merged = applyToApp(merge(cloud, local)); push(merged, true); toast("Dados combinados"); }
}

function pull(cloud, msg) {
  const applied = applyToApp(cloud);
  setBase(S.user.uid, cloud);
  setS({ reconciled: true, status: "synced", lastSync: Date.now() });
  if (applied !== cloud && applied) push(applied, false);     // normalização do app mudou algo: devolve
  if (msg) { toast(msg); document.dispatchEvent(new CustomEvent("cadencia:pulse")); }
}

async function push(json, markReconciled) {
  const user = S.user; if (!user || !json) return;
  clearTimeout(pushTimer); pushTimer = null;
  setBase(user.uid, json);
  setS({ status: navigator.onLine ? "syncing" : "offline", ...(markReconciled ? { reconciled: true } : {}) });
  try {
    await setDoc(doc(db, "users", user.uid), { data: json, updatedAt: serverTimestamp(), device: deviceId, v: 1 });
    if (S.user && S.user.uid === user.uid) setS({ status: "synced", lastSync: Date.now(), error: "" });
    dailyBackup(user.uid, json);
  } catch (e) {
    setS({ status: "error", error: friendly(e) });
  }
}

async function dailyBackup(uid, json) {
  const day = todayKey();
  if (meta.backupDay === day && meta.backupUid === uid) return;
  try {
    await setDoc(doc(db, "users", uid, "backups", day), { data: json, at: serverTimestamp() });
    meta = { ...meta, backupDay: day, backupUid: uid }; saveMeta();
    const all = await getDocs(collection(db, "users", uid, "backups"));   // vem em ordem crescente de dia
    all.docs.slice(0, Math.max(0, all.size - KEEP_BACKUPS)).forEach((d) => deleteDoc(d.ref).catch(() => {}));
  } catch {}
}

window.addEventListener("cadencia:save", (e) => {
  if (!S.user || !S.reconciled) return;
  const json = e.detail;
  if (json === meta.base) return;
  clearTimeout(pushTimer);
  setS({ status: navigator.onLine ? "syncing" : "offline" });
  pushTimer = setTimeout(() => { pushTimer = null; push(json, false); }, 900);
});
window.addEventListener("online", () => { if (S.user) setS({ status: S.reconciled ? "synced" : "syncing" }); });
window.addEventListener("offline", () => { if (S.user) setS({ status: "offline" }); });

/* ── ações ──────────────────────────────────────────────────── */
async function login() {
  if (!auth) return;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  setS({ error: "" });
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    const c = e && e.code || "";
    if (c.includes("popup-closed") || c.includes("cancelled-popup")) return;
    if (c.includes("popup-blocked") || c.includes("operation-not-supported")) return signInWithRedirect(auth, provider);
    setS({ error: friendly(e) }); toast(friendly(e));
  }
}
async function logout() {
  const ok = await confirmSheet("Sair da conta?", "Suas trilhas continuam neste aparelho e na nuvem. Enquanto estiver fora, as mudanças ficam só aqui.", "Sair");
  if (ok) { await signOut(auth); toast("Você saiu da conta"); }
}
async function syncNow() {
  if (!S.user) return;
  const local = localJson();
  if (local && local !== meta.base) await push(local, false);
  else { setS({ status: "synced", lastSync: Date.now() }); }
  toast("Tudo sincronizado");
}
async function listBackups() {
  const snap = await getDocs(collection(db, "users", S.user.uid, "backups"));
  return snap.docs.map((x) => ({ id: x.id, data: x.data().data })).sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, KEEP_BACKUPS);
}
async function restoreBackup(b) {
  const [y, m, d] = b.id.split("-");
  const ok = await confirmSheet(`Restaurar a cópia de ${d}/${m}/${y}?`, `${summary(b.data)}. Isso substitui os dados atuais em todos os aparelhos.`, "Restaurar");
  if (!ok) return;
  const applied = applyToApp(b.data);
  push(applied || b.data, true);
  toast("Cópia restaurada");
}
async function wipeCloud() {
  const ok = await confirmSheet("Apagar seus dados da nuvem?", "Remove as trilhas e todas as cópias diárias guardadas na sua conta. Os dados deste aparelho continuam aqui.", "Apagar da nuvem", true);
  if (!ok) return;
  const uid = S.user.uid;
  try {
    const all = await getDocs(collection(db, "users", uid, "backups"));
    await Promise.all(all.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "users", uid));
    meta = {}; saveMeta();
    await signOut(auth);
    toast("Dados da nuvem apagados");
  } catch (e) { toast(friendly(e)); }
}

/* ── interface ──────────────────────────────────────────────── */
const ICON = {
  google: `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`,
  cloud: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
  cloudOff: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.5 5.2"/></svg>`,
  sync: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
  history: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
  out: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`,
};

const css = `
.cz-card{background:${C.card};border:1px solid ${C.line};border-radius:1.5rem;padding:1rem;margin-bottom:16px;position:relative;overflow:hidden}
.cz-card.cz-in{animation:czIn .45s cubic-bezier(.22,1,.36,1) both}
.cz-h{font-size:.75rem;font-weight:600;color:${C.dim};margin-bottom:.5rem}
.cz-row{display:flex;align-items:center;gap:.75rem}
.cz-av{width:44px;height:44px;border-radius:99px;object-fit:cover;background:${C.card2};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;color:${C.text}}
.cz-name{font-weight:800;line-height:1.2}
.cz-mail{font-size:.8rem;color:${C.dim};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cz-st{display:flex;align-items:center;gap:.5rem;font-size:.78rem;font-weight:700;margin-top:.85rem;padding:.55rem .75rem;border-radius:99px;background:${C.card2};color:${C.dim}}
.cz-dot{width:8px;height:8px;border-radius:99px;flex-shrink:0;background:${C.dim2};position:relative}
.cz-dot.synced{background:${C.mint}} .cz-dot.syncing{background:${C.amber}} .cz-dot.error{background:${C.coral}} .cz-dot.offline{background:${C.dim}}
.cz-dot.syncing::after,.cz-dot.synced.cz-flash::after{content:"";position:absolute;inset:-4px;border-radius:99px;border:2px solid currentColor;color:inherit;animation:czRing 1.2s ease-out infinite}
.cz-dot.syncing::after{color:${C.amber}} .cz-dot.synced::after{color:${C.mint}}
.cz-btns{display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap}
.cz-b{border:none;border-radius:99px;padding:.55rem .85rem;font-size:.75rem;font-weight:800;background:${C.card2};color:${C.text};display:inline-flex;align-items:center;gap:.4rem}
.cz-b.dim{color:${C.dim}} .cz-b.danger{color:${C.coral};background:transparent;padding-left:0}
.cz-b:disabled{opacity:.5}
.cz-b.spin svg{animation:czSpin .8s linear infinite}
.cz-g{width:100%;border:none;border-radius:1rem;padding:.95rem;font-weight:900;font-size:15px;background:#fff;color:#1f1f1f;display:flex;align-items:center;justify-content:center;gap:.6rem;margin-top:.9rem;box-shadow:0 6px 20px rgba(0,0,0,.25)}
.cz-g:disabled{opacity:.6}
.cz-lead{font-weight:800;margin-bottom:.25rem}
.cz-p{font-size:.85rem;color:${C.dim};line-height:1.45}
.cz-ic{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(164,146,255,.14);color:${C.lilac};flex-shrink:0;animation:czFloat 3.2s ease-in-out infinite}
.cz-err{font-size:.78rem;color:${C.coral};margin-top:.6rem;font-weight:700}
.cz-list{margin-top:.75rem;display:flex;flex-direction:column;gap:.4rem;animation:czIn .35s cubic-bezier(.22,1,.36,1) both}
.cz-li{display:flex;justify-content:space-between;align-items:center;background:${C.card2};border:none;color:${C.text};border-radius:.9rem;padding:.65rem .8rem;font-size:.8rem;font-weight:700;text-align:left;width:100%}
.cz-li span{color:${C.dim};font-weight:600}
.cz-li:nth-child(n){animation:czIn .35s cubic-bezier(.22,1,.36,1) both}
.cz-chip{position:relative;width:30px;height:30px;border-radius:99px;display:flex;align-items:center;justify-content:center;color:${C.dim};animation:czPop .4s cubic-bezier(.22,1,.36,1) both}
.cz-chip img{width:30px;height:30px;border-radius:99px;object-fit:cover;box-shadow:0 0 0 2px ${C.bg},0 0 0 3.5px ${C.line};transition:box-shadow .3s}
.cz-chip .cz-dot{position:absolute;right:-1px;bottom:-1px;box-shadow:0 0 0 2.5px ${C.bg}}
.cz-chip.pulse img{animation:czGlow 1.1s ease-out}
.cz-scrim{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:flex-end;animation:czFade .25s ease both}
.cz-scrim.out{animation:czFade .2s ease reverse both}
.cz-sheet{width:100%;max-width:430px;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:1.5rem;padding:1.25rem;margin-bottom:calc(1rem + env(safe-area-inset-bottom));margin-left:max(1rem,calc(50% - 215px));margin-right:max(1rem,calc(50% - 215px));animation:czUp .38s cubic-bezier(.22,1,.36,1) both;color:${C.text};font-family:inherit}
.cz-scrim.out .cz-sheet{animation:czDown .2s ease-in both}
.cz-sheet h3{margin:0 0 .3rem;font-size:1.15rem;font-weight:900}
.cz-opt{width:100%;text-align:left;border:1px solid ${C.line};background:${C.card2};color:${C.text};border-radius:1rem;padding:.8rem .9rem;margin-top:.5rem;font-family:inherit}
.cz-opt b{display:block;font-size:.92rem} .cz-opt small{color:${C.dim};font-size:.78rem}
.cz-opt.rec{border-color:${C.mint}}
.cz-act{display:flex;gap:.5rem;margin-top:1rem}
.cz-act button{flex:1;border:none;border-radius:1rem;padding:.85rem;font-weight:900;font-family:inherit;font-size:14px}
.cz-toast{position:fixed;left:50%;bottom:calc(100px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:95;background:${C.text};color:${C.bg};font-weight:800;font-size:.875rem;padding:.7rem 1rem;border-radius:99px;box-shadow:0 10px 30px rgba(0,0,0,.45);display:flex;align-items:center;gap:.5rem;pointer-events:none;animation:czToast .3s cubic-bezier(.22,1,.36,1) both;white-space:nowrap;max-width:calc(100vw - 32px)}
.cz-toast.out{animation:czToastOut .25s ease-in both}
@keyframes czIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes czFade{from{opacity:0}to{opacity:1}}
@keyframes czUp{from{opacity:0;transform:translateY(40px) scale(.98)}to{opacity:1;transform:none}}
@keyframes czDown{to{opacity:0;transform:translateY(40px) scale(.98)}}
@keyframes czRing{from{opacity:.8;transform:scale(.6)}to{opacity:0;transform:scale(1.6)}}
@keyframes czSpin{to{transform:rotate(360deg)}}
@keyframes czFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes czPop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes czGlow{0%{box-shadow:0 0 0 2px ${C.bg},0 0 0 3.5px ${C.mint}}60%{box-shadow:0 0 0 2px ${C.bg},0 0 0 8px rgba(95,227,180,0)}100%{box-shadow:0 0 0 2px ${C.bg},0 0 0 3.5px ${C.line}}}
@keyframes czToast{from{opacity:0;transform:translate(-50%,18px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes czToastOut{to{opacity:0;transform:translate(-50%,10px)}}
@media (prefers-reduced-motion:reduce){.cz-card,.cz-sheet,.cz-scrim,.cz-toast,.cz-chip,.cz-ic,.cz-list,.cz-li{animation:none!important}}
`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

let toastEl = null, toastTimer = null;
function toast(msg) {
  if (toastEl) toastEl.remove();
  toastEl = el(`<div class="cz-toast" role="status">${ICON.sync.replace('width="16" height="16"', 'width="14" height="14"')}<span>${esc(msg)}</span></div>`);
  document.body.appendChild(toastEl);
  clearTimeout(toastTimer);
  const mine = toastEl;
  toastTimer = setTimeout(() => { mine.classList.add("out"); setTimeout(() => mine.remove(), 260); }, 2400);
}

function sheet(html, bind) {
  return new Promise((resolve) => {
    const scrim = el(`<div class="cz-scrim"><div class="cz-sheet" role="dialog" aria-modal="true">${html}</div></div>`);
    const close = (v) => { scrim.classList.add("out"); setTimeout(() => scrim.remove(), 210); resolve(v); };
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(bind.dismiss); });
    bind.wire(scrim, close);
    document.body.appendChild(scrim);
  });
}
function confirmSheet(title, desc, cta, danger) {
  return sheet(`<h3>${esc(title)}</h3><div class="cz-p">${esc(desc)}</div>
    <div class="cz-act"><button data-no style="background:${C.card2};color:${C.text}">Cancelar</button>
    <button data-yes style="background:${danger ? C.coral : C.mint};color:${C.bg}">${esc(cta)}</button></div>`,
  { dismiss: false, wire: (s, close) => { s.querySelector("[data-no]").onclick = () => close(false); s.querySelector("[data-yes]").onclick = () => close(true); } });
}
function askConflict(local, cloud) {
  return sheet(`<h3>Dados nos dois lugares</h3>
    <div class="cz-p">Este aparelho e a sua conta já têm trilhas. O que fazer?</div>
    <button class="cz-opt rec" data-v="merge"><b>Juntar tudo (recomendado)</b><small>Mantém as trilhas e registros dos dois lados</small></button>
    <button class="cz-opt" data-v="cloud"><b>Usar os da nuvem</b><small>${esc(summary(cloud))}</small></button>
    <button class="cz-opt" data-v="local"><b>Usar os deste aparelho</b><small>${esc(summary(local))}</small></button>`,
  { dismiss: "merge", wire: (s, close) => s.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => close(b.dataset.v))) });
}
function welcome() {
  if (S.status !== "signedout" || ls.get(WELCOME_KEY)) return;
  ls.set(WELCOME_KEY, "1");
  sheet(`<div class="cz-row" style="margin-bottom:.75rem"><div class="cz-ic">${ICON.cloud}</div>
      <div><h3 style="margin:0">Suas trilhas em qualquer aparelho</h3></div></div>
    <div class="cz-p">Entre com sua conta Google para guardar tudo na nuvem com segurança e continuar de onde parou no celular, tablet ou computador. Funciona sem internet também.</div>
    <button class="cz-g" data-go>${ICON.google} Entrar com Google</button>
    <button class="cz-b dim" data-no style="width:100%;justify-content:center;margin-top:.5rem;background:transparent">Agora não</button>`,
  { dismiss: null, wire: (s, close) => { s.querySelector("[data-go]").onclick = () => { close(null); login(); }; s.querySelector("[data-no]").onclick = () => close(null); } });
}

const statusText = () => ({
  synced: S.lastSync ? `Sincronizado · ${hhmm(S.lastSync)}` : "Sincronizado",
  syncing: "Sincronizando…",
  offline: "Sem internet — as mudanças sobem quando voltar",
  error: S.error || "Erro ao sincronizar",
}[S.status] || "");

/* Cartão dentro de Ajustes */
const cards = new Set();
let showBackups = false, backupsCache = null, busy = false;
function renderCard(host) {
  const first = !host.firstChild;
  let html;
  if (S.status === "off") {
    html = `<div class="cz-h">Conta e sincronização</div><div class="cz-card"><div class="cz-row"><div class="cz-ic">${ICON.cloudOff}</div>
      <div><div class="cz-lead">Nuvem não configurada</div><div class="cz-p">Preencha o arquivo <b>firebase-config.js</b> para ativar o login com Google (veja o README).</div></div></div></div>`;
  } else if (!S.user) {
    html = `<div class="cz-h">Conta e sincronização</div><div class="cz-card"><div class="cz-row"><div class="cz-ic">${ICON.cloud}</div>
      <div><div class="cz-lead">Use em qualquer aparelho</div><div class="cz-p">Entre com Google para guardar suas trilhas na nuvem e editar do celular ou do computador.</div></div></div>
      <button class="cz-g" data-a="login" ${busy ? "disabled" : ""}>${ICON.google} Entrar com Google</button>
      ${S.error ? `<div class="cz-err">${esc(S.error)}</div>` : ""}</div>`;
  } else {
    const u = S.user, name = u.displayName || "Sua conta", ini = esc(name.trim()[0] || "?").toUpperCase();
    const av = u.photoURL ? `<img class="cz-av" src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<div class="cz-av">${ini}</div>`;
    const list = showBackups ? (backupsCache === null ? `<div class="cz-list"><div class="cz-p">Carregando cópias…</div></div>`
      : backupsCache.length ? `<div class="cz-list">${backupsCache.map((b, i) => { const [y, m, d] = b.id.split("-");
          return `<button class="cz-li" data-b="${i}" style="animation-delay:${i * 30}ms">${d}/${m}/${y}<span>${esc(summary(b.data))}</span></button>`; }).join("")}</div>`
      : `<div class="cz-list"><div class="cz-p">Nenhuma cópia ainda. Uma é guardada por dia, automaticamente.</div></div>`) : "";
    html = `<div class="cz-h">Conta e sincronização</div><div class="cz-card"><div class="cz-row">${av}
      <div style="min-width:0"><div class="cz-name">${esc(name)}</div><div class="cz-mail">${esc(u.email || "")}</div></div></div>
      <div class="cz-st"><span class="cz-dot ${S.status}"></span><span>${esc(statusText())}</span></div>
      <div class="cz-btns">
        <button class="cz-b ${S.status === "syncing" ? "spin" : ""}" data-a="sync">${ICON.sync} Sincronizar</button>
        <button class="cz-b" data-a="backups">${ICON.history} Cópias diárias</button>
        <button class="cz-b dim" data-a="logout">${ICON.out} Sair</button>
      </div>${list}
      ${showBackups ? `<button class="cz-b danger" data-a="wipe" style="margin-top:.75rem">Apagar meus dados da nuvem</button>` : ""}</div>`;
  }
  host.innerHTML = html;
  if (first) host.querySelector(".cz-card")?.classList.add("cz-in");
  host.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    if (a === "login") { busy = true; refresh(); await login(); busy = false; refresh(); }
    if (a === "sync") syncNow();
    if (a === "logout") logout();
    if (a === "wipe") wipeCloud();
    if (a === "backups") {
      showBackups = !showBackups; refresh();
      if (showBackups) { backupsCache = null; refresh(); try { backupsCache = await listBackups(); } catch (e) { backupsCache = []; toast(friendly(e)); } refresh(); }
    }
  }));
  host.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => restoreBackup(backupsCache[+b.dataset.b])));
}

/* Avatar/estado no topo da tela Hoje */
const chips = new Set();
function renderChip(host) {
  if (S.status === "off") { host.innerHTML = ""; return; }
  if (!S.user) { host.innerHTML = `<span class="cz-chip" title="Entrar para sincronizar" aria-label="sem conta conectada">${ICON.cloudOff}</span>`; return; }
  const u = S.user;
  const pic = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="cz-av" style="width:30px;height:30px;font-size:.8rem">${esc((u.displayName || "?")[0]).toUpperCase()}</span>`;
  const existing = host.querySelector(".cz-chip");
  if (existing && existing.dataset.uid === u.uid) { existing.querySelector(".cz-dot").className = `cz-dot ${S.status}`; existing.title = statusText(); return; }
  host.innerHTML = `<span class="cz-chip" data-uid="${esc(u.uid)}" title="${esc(statusText())}" aria-label="conta">${pic}<span class="cz-dot ${S.status}"></span></span>`;
}
document.addEventListener("cadencia:pulse", () => chips.forEach((h) => {
  const c = h.querySelector(".cz-chip"); if (!c) return;
  c.classList.remove("pulse"); void c.offsetWidth; c.classList.add("pulse");
}));

function refresh() {
  for (const h of cards) h.isConnected ? renderCard(h) : cards.delete(h);
  for (const h of chips) h.isConnected ? renderChip(h) : chips.delete(h);
}
listeners.add(refresh);

window.__cadMount = (host) => { if (cards.has(host)) return; cards.add(host); showBackups = false; renderCard(host); };
window.__cadChip = (host) => { if (chips.has(host)) return; chips.add(host); renderChip(host); };
// o app pode ter renderizado antes deste arquivo (carregado com defer): monta o que ficou na fila
(window.__cadQ || []).splice(0).forEach(([k, h]) => h.isConnected && (k === "m" ? window.__cadMount : window.__cadChip)(h));

if (configured) onReady(() => setTimeout(() => { if (!S.user && auth && auth.currentUser === null) welcome(); }, 1600));
