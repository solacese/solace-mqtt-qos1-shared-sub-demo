/**
 * Anchor registry for the flow animation.
 *
 * Packet cards travel between real DOM elements — the MQTT panel, the queue
 * node, each consumer card. Rather than hard-coding coordinates (which break the
 * moment the window resizes, a consumer is added, or a panel scrolls), elements
 * register themselves here and FlowLayer measures them live.
 */

export class AnchorRegistry {
  /** @type {Map<string, HTMLElement>} */
  #els = new Map()

  set(name, el) {
    this.#els.set(name, el)
  }

  delete(name) {
    this.#els.delete(name)
  }

  get(name) {
    return this.#els.get(name) ?? null
  }

  /**
   * An anchor's box in coordinates relative to `container`, or null if it isn't
   * mounted or has been collapsed to zero size. Callers get the edges as well as
   * the centre so a packet can be parked *beside* a panel rather than on top of
   * it, in the gutter where it stays readable.
   */
  box(name, containerRect) {
    const el = this.#els.get(name)
    if (!el || !containerRect) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return null
    return {
      left: r.left - containerRect.left,
      right: r.right - containerRect.left,
      top: r.top - containerRect.top,
      bottom: r.bottom - containerRect.top,
      cx: r.left - containerRect.left + r.width / 2,
      cy: r.top - containerRect.top + r.height / 2,
    }
  }
}

/** Svelte action: `use:anchor={{ registry, name }}` */
export function anchor(node, params) {
  let name = params.name
  params.registry.set(name, node)
  return {
    update(next) {
      if (next.name !== name) {
        params.registry.delete(name)
        name = next.name
      }
      next.registry.set(name, node)
    },
    destroy() {
      params.registry.delete(name)
    },
  }
}
