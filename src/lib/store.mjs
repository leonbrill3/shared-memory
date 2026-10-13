// Store selector: Postgres when DATABASE_URL is set (production/shared),
// otherwise the local file store (dev). Same async interface either way.
let impl;
if (process.env.DATABASE_URL) {
  impl = await import('./store-pg.mjs');
  console.error('[shared-memory] store: Postgres');
} else {
  impl = await import('./store-file.mjs');
  console.error('[shared-memory] store: file (local)');
}

export const addFact = (a) => impl.addFact(a);
export const updateFact = (id, p) => impl.updateFact(id, p);
export const deleteFact = (id) => impl.deleteFact(id);
export const searchFacts = (q, o) => impl.searchFacts(q, o);
export const listFacts = (o) => impl.listFacts(o);
export const stats = () => impl.stats();
