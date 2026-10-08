/* Cadência — núcleo da sincronização: funções puras, sem Firebase nem DOM (testadas em tests/sync-core.test.mjs).
 *
 * O estado do app trafega como uma string JSON: { version, kinds[], units[], items[{ id, ..., logs: { "AAAA-MM-DD": n } }] }.
 * "base" é a última versão que este aparelho sabe estar igual na nuvem e no aparelho (o ancestral comum
 * de um merge de três vias): comparando local e nuvem com ela, sabemos qual lado mudou.
 */

export const parse = (json) => { try { return JSON.parse(json); } catch { return null; } };

export const isEmpty = (json) => {
  const d = parse(json);
  return !d || !Array.isArray(d.items) || d.items.length === 0;
};

export const summary = (json) => {
  const d = parse(json);
  if (!d || !Array.isArray(d.items)) return "vazio";
  const days = d.items.reduce((n, it) => n + Object.keys(it.logs || {}).length, 0);
  return `${d.items.length} trilha${d.items.length === 1 ? "" : "s"} · ${days} registro${days === 1 ? "" : "s"}`;
};

/* Junta duas versões. `a` tem preferência nos campos conflitantes; trilhas que só existem em um lado
 * são mantidas; no mesmo dia, fica o maior registro (perder progresso é pior que contar a mais). */
export function merge(aJson, bJson) {
  const A = parse(aJson) || { items: [] }, B = parse(bJson) || { items: [] };
  const uniq = (x, y) => [...new Set([...(x || []), ...(y || [])])];
  const byId = new Map();
  for (const it of A.items || []) byId.set(it.id, { ...it, logs: { ...(it.logs || {}) } });
  for (const it of B.items || []) {
    const cur = byId.get(it.id);
    if (!cur) { byId.set(it.id, it); continue; }
    for (const [k, v] of Object.entries(it.logs || {})) cur.logs[k] = Math.max(cur.logs[k] || 0, v);
  }
  return JSON.stringify({
    version: A.version || B.version || 3,
    kinds: uniq(A.kinds, B.kinds),
    units: uniq(A.units, B.units),
    items: [...byId.values()],
  });
}

/* Decide o que fazer quando chega a versão da nuvem.
 *   local  — JSON atual do aparelho (ou null)
 *   cloud  — JSON da nuvem (ou null se a conta ainda não tem dados)
 *   base   — último JSON sincronizado por este aparelho NESTA conta; undefined se é o primeiro login aqui
 * Retorna uma de: "noop" | "push" | "pull" | "merge" | "ask".
 */
export function decide(local, cloud, base) {
  if (cloud == null) return local ? "push" : "noop";
  if (local === cloud) return "noop";
  if (base !== undefined) {
    const localChanged = local !== base, cloudChanged = cloud !== base;
    if (localChanged && !cloudChanged) return "push";
    if (!localChanged && cloudChanged) return "pull";
    return "merge";
  }
  if (isEmpty(local)) return "pull";
  if (isEmpty(cloud)) return "push";
  return "ask";
}
