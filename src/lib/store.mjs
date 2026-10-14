// Store selector: Postgres (multi-tenant) when DATABASE_URL is set, else the
// local file store (single user). Every fact call is scoped to a userId.
let impl;
if (process.env.DATABASE_URL) {
  impl = await import('./store-pg.mjs');
  console.error('[shared-memory] store: Postgres (multi-tenant)');
} else {
  impl = await import('./store-file.mjs');
  console.error('[shared-memory] store: file (local)');
}

export const getUserIdByToken = (t) => impl.getUserIdByToken(t);
export const createUser = (label) => impl.createUser(label);
export const addFact = (u, a) => impl.addFact(u, a);
export const updateFact = (u, id, p) => impl.updateFact(u, id, p);
export const deleteFact = (u, id) => impl.deleteFact(u, id);
export const searchFacts = (u, q, o) => impl.searchFacts(u, q, o);
export const listFacts = (u, o) => impl.listFacts(u, o);
export const stats = (u) => impl.stats(u);
