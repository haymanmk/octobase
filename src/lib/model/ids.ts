// Stable, sortable-ish unique IDs without external deps. Format:
// <prefix>_<base36 time><base36 random>. Good enough for a local-first store;
// a sync layer can keep using opaque string IDs unchanged.

function rand(): string {
  // 8 chars of base36 randomness.
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += Math.floor(Math.random() * 36).toString(36);
  }
  return s;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${rand()}`;
}

export const ID = {
  card: () => newId("card"),
  whiteboard: () => newId("wb"),
  placement: () => newId("pl"),
  link: () => newId("ln"),
  edge: () => newId("ed"),
};
