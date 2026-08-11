/**
 * Stable colour per partition key.
 *
 * The whole demo hinges on being able to see, at a glance, that every message
 * carrying the same partition key lands on the same consumer. Colour is the
 * cheapest way to make that legible, so it must be deterministic: the same key
 * always produces the same colour, across reloads and across consumers.
 *
 * That determinism rules out assigning colours by first-seen order — two
 * consumers observing different subsets of the traffic would disagree about what
 * `order-3` looks like, and the one thing this visualisation must never do is
 * make a key look like it moved when it did not. So the colour is a pure
 * function of the key string.
 *
 * ## Why a fixed palette rather than a computed hue
 *
 * This previously derived a hue arithmetically from the hash, which spread the
 * hues *randomly* rather than *evenly*: with only four keys on screen, `order-1`
 * and `order-4` both landed on near-identical rose and were not tellable apart.
 * A small hand-picked palette is the fix — the slots are chosen to be distinct
 * instead of merely different.
 *
 * The eight slots below are the dark-surface steps of a validated categorical
 * palette, checked with the data-viz validator against this app's own surface
 * (`--color-ink-950`, #090d16):
 *
 *   - The four slots the demo's default keys land on — order-1..order-4 — were
 *     selected as a set that passes lightness, chroma, all-pairs normal-vision
 *     separation (worst ΔE 19.3) and 3:1 contrast. Their worst CVD pair is
 *     ΔE 6.9 (protan), inside the band the method permits *only* alongside
 *     secondary encoding. Every chip in this app is labelled with its key text,
 *     and each consumer lists the keys it owns, so identity is never carried by
 *     colour alone. That is what makes the WARN acceptable here.
 *   - Beyond four simultaneous keys, no ordering of these hues clears the
 *     all-pairs floors on a dark surface — 0 of 56 five-hue subsets passed. The
 *     later slots are therefore best-effort, and the key label is what actually
 *     distinguishes them. Prefer four keys when the colours have to do the work,
 *     which is also the default the publisher ships with.
 */

/**
 * FNV-1a, 32-bit. Small, fast, and well spread for short ASCII keys.
 *
 * Exported because the comparison tab needs to derive a *partition* from a key
 * as well as a colour, and both have the same requirement: the same key must
 * always produce the same answer.
 */
export function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * The palette, in slot order.
 *
 * The order is not cosmetic. Keys hash into these slots with `% PALETTE.length`,
 * and the demo's default keys land on slots 4–7 — so those four hold the
 * validated quartet, and `order-1`..`order-4` come out blue / yellow / magenta /
 * green. Reordering this array silently degrades the default four-key case.
 */
const PALETTE = [
  '#e66767', // 0 · red      → order-6
  '#d95926', // 1 · orange   → order-5
  '#199e70', // 2 · aqua     → order-8
  '#9085e9', // 3 · violet   → order-7
  '#c98500', // 4 · yellow   → order-2
  '#3987e5', // 5 · blue     → order-1
  '#008300', // 6 · green    → order-4
  '#d55181', // 7 · magenta  → order-3
]

/** No partition key: deliberately colourless. See keyCss below. */
const NEUTRAL = '#9ca3af'

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The slot a key occupies. A pure function of the key, by design. */
export function keySlot(key) {
  return fnv1a(key) % PALETTE.length
}

/** The base colour for a key, as hex. */
export function keyColor(key) {
  // No partition key: Solace assigns these messages to a random partition, so
  // pretending they have a stable identity would be a lie. Grey says "no key".
  if (!key) return NEUTRAL
  return PALETTE[keySlot(key)]
}

/**
 * The four surfaces a key's colour is used on. Callers only ever want these, so
 * the underlying representation stays private to this module.
 */
export function keyCss(key) {
  const hex = keyColor(key)
  const [r, g, b] = rgb(hex)
  return {
    fg: hex,
    bg: `rgb(${r} ${g} ${b} / 0.16)`,
    border: `rgb(${r} ${g} ${b} / 0.55)`,
    glow: `rgb(${r} ${g} ${b} / 0.35)`,
  }
}
