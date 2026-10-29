// Stable fingerprints of the state slices each stage reads. A stage whose
// fingerprint is unchanged has unchanged inputs (including upstream outputs),
// so its previous output remains valid and can be reused.

/** JSON with sorted object keys; undefined values are omitted; non-finite numbers become strings. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** 32-bit FNV-1a hash as 8 hex characters. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Per-key digests plus the combined fingerprint for a list of read paths. */
export function fingerprintOf(view: unknown, reads: string[]) {
  const digest: Record<string, string> = {};
  for (const key of reads) digest[key] = fnv1a(stableStringify(getPath(view, key)));
  return { fingerprint: fnv1a(stableStringify(digest)), digest };
}

export function changedKeys(a: Record<string, string>, b: Record<string, string>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]);
}
