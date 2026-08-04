/**
 * Stable colour per partition key.
 *
 * The whole demo hinges on being able to see, at a glance, that every message
 * carrying the same partition key lands on the same consumer. Colour is the
 * cheapest way to make that legible, so it must be deterministic: the same key
 * always produces the same hue, across reloads and across consumers.
 */

/** FNV-1a, 32-bit. Small, fast, and well spread for short ASCII keys. */
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Golden-angle hue stepping so that keys which hash to nearby values still get
 * visually distinct hues, rather than two near-identical blues.
 */
export function keyColor(key) {
  if (!key) {
    // No partition key: deliberately colourless. Solace assigns these messages
    // to a random partition, so pretending they have an identity would be a lie.
    return { h: 0, s: 0, l: 62 }
  }
  const h = (hash(key) * 137.508) % 360
  return { h, s: 68, l: 60 }
}

export function keyCss(key) {
  const { h, s, l } = keyColor(key)
  return {
    fg: `hsl(${h} ${s}% ${l}%)`,
    bg: `hsl(${h} ${s}% ${l}% / 0.16)`,
    border: `hsl(${h} ${s}% ${l}% / 0.55)`,
    glow: `hsl(${h} ${s}% ${l}% / 0.35)`,
  }
}
