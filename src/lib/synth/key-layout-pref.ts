import { DEFAULT_KEY_LAYOUT, isKeyLayoutId, type KeyLayoutId } from "./keyboard-map";

/** Per-browser preference, like Quire's: not part of a sound or a session. */
export const KEY_LAYOUT_STORAGE_KEY = "phosphor.keys.layout.v1";

type Store = Pick<Storage, "getItem" | "setItem">;
function storage(): Store | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

let current: KeyLayoutId = (() => {
  try {
    const saved = storage()?.getItem(KEY_LAYOUT_STORAGE_KEY);
    return isKeyLayoutId(saved) ? saved : DEFAULT_KEY_LAYOUT;
  } catch { return DEFAULT_KEY_LAYOUT; }
})();
const listeners = new Set<() => void>();

export function getKeyLayout(): KeyLayoutId { return current; }
export function setKeyLayout(next: KeyLayoutId) {
  if (!isKeyLayoutId(next) || next === current) return;
  current = next;
  try { storage()?.setItem(KEY_LAYOUT_STORAGE_KEY, next); } catch { /* preference only */ }
  listeners.forEach((fn) => fn());
}
export function subscribeKeyLayout(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
