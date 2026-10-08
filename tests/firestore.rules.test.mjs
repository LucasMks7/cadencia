// Testes das regras de segurança do Firestore contra o emulador. Rodar: npm run test:rules
// (sobe o emulador do Firestore, roda os testes e desliga — precisa de Java 11+).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, setLogLevel } from "firebase/firestore";

setLogLevel("silent"); // as negações abaixo são esperadas; não poluir a saída

let env;
const userDoc = () => ({ data: JSON.stringify({ items: [] }), updatedAt: new Date(), device: "d1", v: 1 });
const backup = () => ({ data: JSON.stringify({ items: [] }), at: new Date() });

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-cadencia",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
});
beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

test("dono lê e grava o próprio documento", async () => {
  const db = as("ana");
  await assertSucceeds(setDoc(doc(db, "users/ana"), userDoc()));
  await assertSucceeds(getDoc(doc(db, "users/ana")));
  await assertSucceeds(deleteDoc(doc(db, "users/ana")));
});

test("outra conta não lê nem grava os dados de ninguém", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/ana"), userDoc()));
  const db = as("bruno");
  await assertFails(getDoc(doc(db, "users/ana")));
  await assertFails(setDoc(doc(db, "users/ana"), userDoc()));
  await assertFails(deleteDoc(doc(db, "users/ana")));
});

test("visitante sem login não acessa nada", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/ana"), userDoc()));
  const db = as(null);
  await assertFails(getDoc(doc(db, "users/ana")));
  await assertFails(setDoc(doc(db, "users/ana"), userDoc()));
});

test("campos fora do esquema são recusados", async () => {
  await assertFails(setDoc(doc(as("ana"), "users/ana"), { ...userDoc(), admin: true }));
});

test("'data' precisa ser string e menor que ~900 KB", async () => {
  const db = as("ana");
  await assertFails(setDoc(doc(db, "users/ana"), { ...userDoc(), data: { items: [] } }));
  await assertFails(setDoc(doc(db, "users/ana"), { ...userDoc(), data: "x".repeat(900_001) }));
  await assertSucceeds(setDoc(doc(db, "users/ana"), { ...userDoc(), data: "x".repeat(10_000) }));
});

test("cópias diárias: só o dono, e o ID precisa ser uma data AAAA-MM-DD", async () => {
  await assertSucceeds(setDoc(doc(as("ana"), "users/ana/backups/2026-10-08"), backup()));
  await assertSucceeds(getDocs(collection(as("ana"), "users/ana/backups")));
  await assertFails(setDoc(doc(as("ana"), "users/ana/backups/qualquer-coisa"), backup()));
  await assertFails(getDocs(collection(as("bruno"), "users/ana/backups")));
  await assertFails(setDoc(doc(as("bruno"), "users/ana/backups/2026-10-08"), backup()));
});

test("qualquer outra coleção é negada", async () => {
  await assertFails(setDoc(doc(as("ana"), "publico/x"), { a: 1 }));
  await assertFails(getDoc(doc(as("ana"), "publico/x")));
});
