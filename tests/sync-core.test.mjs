// Testes do núcleo de sincronização (funções puras). Rodar: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, decide, isEmpty, summary } from "../src/cloud/sync-core.js";

const state = (items, extra = {}) => JSON.stringify({ version: 3, kinds: ["Curso"], units: ["aulas"], items, ...extra });
const item = (id, logs = {}, extra = {}) => ({ id, title: id, logs, ...extra });

test("isEmpty: null, JSON inválido e lista vazia contam como vazio", () => {
  assert.equal(isEmpty(null), true);
  assert.equal(isEmpty("{oops"), true);
  assert.equal(isEmpty(state([])), true);
  assert.equal(isEmpty(state([item("a")])), false);
});

test("summary: conta trilhas e dias registrados, com plural certo", () => {
  assert.equal(summary(state([item("a", { "2026-10-01": 2 })])), "1 trilha · 1 registro");
  assert.equal(summary(state([item("a", { d1: 1, d2: 1 }), item("b")])), "2 trilhas · 2 registros");
  assert.equal(summary("lixo"), "vazio");
});

test("merge: mantém trilhas que só existem de um lado", () => {
  const out = JSON.parse(merge(state([item("a"), item("b")]), state([item("b"), item("c")])));
  assert.deepEqual(out.items.map((i) => i.id), ["a", "b", "c"]);
});

test("merge: no mesmo dia fica o maior registro; dias diferentes são somados ao conjunto", () => {
  const a = state([item("x", { "2026-10-01": 3, "2026-10-02": 1 })]);
  const b = state([item("x", { "2026-10-01": 5, "2026-10-03": 2 })]);
  const out = JSON.parse(merge(a, b));
  assert.deepEqual(out.items[0].logs, { "2026-10-01": 5, "2026-10-02": 1, "2026-10-03": 2 });
});

test("merge: o primeiro argumento vence em campos conflitantes (título, meta…)", () => {
  const out = JSON.parse(merge(state([item("x", {}, { title: "nuvem", dailyGoal: 3 })]), state([item("x", {}, { title: "local", dailyGoal: 9 })])));
  assert.equal(out.items[0].title, "nuvem");
  assert.equal(out.items[0].dailyGoal, 3);
});

test("merge: une categorias e unidades sem repetir", () => {
  const out = JSON.parse(merge(state([], { kinds: ["Curso", "Livro"] }), state([], { kinds: ["Livro", "Matéria"] })));
  assert.deepEqual(out.kinds, ["Curso", "Livro", "Matéria"]);
});

test("merge é idempotente: juntar o resultado de novo não muda nada", () => {
  const once = merge(state([item("a", { d: 1 })]), state([item("b", { d: 2 })]));
  assert.equal(merge(once, once), once);
});

const A = state([item("a")]), B = state([item("b")]), BASE = state([item("base")]);

test("decide: conta nova (nada na nuvem) → envia o que há no aparelho", () => {
  assert.equal(decide(A, null, undefined), "push");
  assert.equal(decide(null, null, undefined), "noop");
});

test("decide: aparelho e nuvem iguais → nada a fazer", () => {
  assert.equal(decide(A, A, undefined), "noop");
  assert.equal(decide(A, A, BASE), "noop");
});

test("decide: aparelho já sincronizado — só o aparelho mudou → push", () => {
  assert.equal(decide(A, BASE, BASE), "push");
});

test("decide: aparelho já sincronizado — só a nuvem mudou → pull", () => {
  assert.equal(decide(BASE, B, BASE), "pull");
});

test("decide: aparelho já sincronizado — os dois mudaram (edição offline) → merge", () => {
  assert.equal(decide(A, B, BASE), "merge");
});

test("decide: primeiro login aqui — aparelho vazio → pull", () => {
  assert.equal(decide(state([]), B, undefined), "pull");
  assert.equal(decide(null, B, undefined), "pull");
});

test("decide: primeiro login aqui — nuvem vazia → push", () => {
  assert.equal(decide(A, state([]), undefined), "push");
});

test("decide: primeiro login aqui — dados nos dois lados → pergunta ao usuário", () => {
  assert.equal(decide(A, B, undefined), "ask");
});
