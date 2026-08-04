/**
 * localStorage-backed config persistence.
 *
 * Passwords are deliberately NOT persisted. This is a demo app that people run
 * against real brokers, often on a projector; a password quietly surviving in
 * localStorage is a nasty surprise. They are re-entered each session.
 */

const PREFIX = 'mqtt-solace-demo:'
const SECRET_KEYS = new Set(['password'])

export function load(name, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (!raw) return { ...fallback }
    const saved = JSON.parse(raw)
    // Merge onto the fallback so new fields added in later versions of the app
    // still get their defaults instead of coming back undefined.
    const merged = { ...fallback }
    for (const [k, v] of Object.entries(saved)) {
      if (k in fallback && !SECRET_KEYS.has(k)) merged[k] = v
    }
    return merged
  } catch {
    return { ...fallback }
  }
}

export function save(name, value) {
  try {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (!SECRET_KEYS.has(k) && typeof v !== 'function') out[k] = v
    }
    localStorage.setItem(PREFIX + name, JSON.stringify(out))
  } catch {
    // Private browsing / quota exceeded. Persistence is a convenience, never
    // load-bearing, so a failure here must not break the app.
  }
}

/** Short random suffix for client IDs, so two open tabs don't take each other down. */
export function randomSuffix(n = 6) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + n)
}
