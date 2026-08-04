<script>
  import PacketCard from './PacketCard.svelte'
  import { SLIDE_MS } from '../lib/flow.svelte.js'

  let { flow, registry, container, consumerIds = [] } = $props()

  /** packet id -> its card element, registered by each PacketCard. */
  const nodes = new Map()
  function register(id, el) {
    if (el) nodes.set(id, el)
    else {
      nodes.delete(id)
      anim.delete(id)
    }
  }

  /** Edge key -> its <path> element. 'pub' plus one per consumer. */
  const edges = new Map()
  function edge(node, params) {
    let key = params.key
    edges.set(key, node)
    return {
      update(next) {
        if (next.key !== key) {
          edges.delete(key)
          key = next.key
        }
        edges.set(key, node)
      },
      destroy() {
        edges.delete(key)
      },
    }
  }

  /**
   * Per-packet visual state. Deliberately separate from the packet's *logical*
   * phase: the logical phase flips the instant a broker callback fires (a PUBACK
   * on localhost lands in about a millisecond), whereas the card still has to be
   * seen travelling the line. So the visual stage advances on its own clock and
   * the logical phase decides what the card looks like when it gets there.
   *
   * { stage, t0, x, y, fromX, fromY }
   */
  const anim = new Map()

  const CARD_W = 132
  const CARD_H = 40
  const GAP = 10
  /** Max queued cards to fan out before they pile on the last slot. */
  const FAN = 6
  const FAN_STEP = 22

  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t))
  const lerp = (a, b, f) => a + (b - a) * f
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  /** Horizontal pull on the control points, so edges leave and arrive flat. */
  const bend = (x1, x2) => Math.max(40, Math.abs(x2 - x1) * 0.45)

  function cubic(p0, p1, p2, p3, t) {
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    }
  }

  /** The same geometry the card follows, as an SVG path string. */
  function edgePath(from, to) {
    const dx = bend(from.x, to.x)
    return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
  }

  $effect(() => {
    if (!container) return

    let frame
    const tick = () => {
      frame = requestAnimationFrame(tick)

      const rect = container.getBoundingClientRect()
      const pub = registry.box('mqtt', rect)
      const queue = registry.box('queue', rect)

      // ---- draw the edges ------------------------------------------------
      // Publisher's right edge into the queue's left edge, then the queue's
      // right edge out to each consumer. Recomputed every frame so the lines
      // track resizing, panel collapse and consumers coming and going.
      const pubEdge =
        pub && queue ? { from: { x: pub.right, y: pub.cy }, to: { x: queue.left, y: queue.cy } } : null

      const pubEl = edges.get('pub')
      if (pubEl) pubEl.setAttribute('d', pubEdge ? edgePath(pubEdge.from, pubEdge.to) : '')

      const consumerEdges = new Map()
      for (const id of consumerIds) {
        const box = registry.box(`consumer-${id}`, rect)
        const el = edges.get(id)
        if (!box || !queue) {
          if (el) el.setAttribute('d', '')
          continue
        }
        const e = { from: { x: queue.right, y: queue.cy }, to: { x: box.left, y: box.cy } }
        consumerEdges.set(id, e)
        if (el) el.setAttribute('d', edgePath(e.from, e.to))
      }

      if (flow.packets.length === 0) {
        for (const el of edges.values()) el.classList.remove('flow-edge-active')
        return
      }

      const now = performance.now()
      const activeEdges = new Set()
      let fanIndex = 0

      for (const packet of flow.packets) {
        const el = nodes.get(packet.id)
        if (!el) continue

        let a = anim.get(packet.id)
        if (!a) {
          // A packet we published starts at the publisher and travels in. One that
          // was already on the queue when we bound (backlog, or a redelivery) has
          // no journey from the publisher to show, so it starts at the queue.
          a = packet.external
            ? { stage: 'atQueue', t0: now, x: null, y: null }
            : { stage: 'toQueue', t0: now, x: null, y: null }
          anim.set(packet.id, a)
        }

        // ---- advance the visual stage ------------------------------------
        const elapsed = now - a.t0
        if (a.stage === 'toQueue' && elapsed >= SLIDE_MS) {
          a.stage = 'atQueue'
          a.t0 = now
        }
        if (a.stage === 'atQueue' && packet.consumerId && consumerEdges.has(packet.consumerId)) {
          // Only depart once we know which consumer actually took it.
          a.stage = 'toConsumer'
          a.t0 = now
          a.fromX = a.x
          a.fromY = a.y
        }
        if (a.stage === 'toConsumer' && now - a.t0 >= SLIDE_MS) {
          a.stage = 'atConsumer'
          a.t0 = now
        }

        // ---- resolve a position for the current stage ---------------------
        let point = null

        if (a.stage === 'toQueue') {
          if (pubEdge) {
            const t = easeInOut(clamp(elapsed / SLIDE_MS, 0, 1))
            // Stop just short of the queue node so the card's edge meets it.
            const target = { x: pubEdge.to.x - GAP - CARD_W / 2, y: pubEdge.to.y }
            const dx = bend(pubEdge.from.x, target.x)
            point = cubic(
              pubEdge.from,
              { x: pubEdge.from.x + dx, y: pubEdge.from.y },
              { x: target.x - dx, y: target.y },
              target,
              t
            )
          }
        } else if (a.stage === 'atQueue') {
          if (queue) {
            // Clear of the queue node itself, so a waiting card never sits on
            // top of the node's own labels while it settles into its slot.
            const slot = Math.min(fanIndex++, FAN)
            point = { x: queue.cx, y: queue.bottom + 56 + slot * FAN_STEP }
          }
        } else if (a.stage === 'toConsumer') {
          const e = consumerEdges.get(packet.consumerId)
          if (e) {
            const t = easeInOut(clamp((now - a.t0) / SLIDE_MS, 0, 1))
            const target = { x: e.to.x - GAP - CARD_W / 2, y: e.to.y }
            const from = { x: a.fromX ?? e.from.x, y: a.fromY ?? e.from.y }
            const dx = bend(from.x, target.x)
            // First control point sits on the edge's own origin, so a card
            // leaving the queued stack curves onto the drawn line rather than
            // cutting its own diagonal across the gap.
            point = cubic(from, { x: e.from.x + dx * 0.5, y: e.from.y }, { x: target.x - dx, y: target.y }, target, t)
            activeEdges.add(packet.consumerId)
          }
        } else if (a.stage === 'atConsumer') {
          const box = packet.consumerId ? registry.box(`consumer-${packet.consumerId}`, rect) : null
          if (box) point = { x: box.left - GAP - CARD_W / 2, y: box.cy }
        }

        // The consumer may have been removed, or an anchor may not be mounted
        // yet. Hold the last known position rather than snapping to (0,0).
        if (!point) {
          if (a.x === null) continue
          point = { x: a.x, y: a.y }
        }

        if (a.stage === 'toQueue' && a.x !== null) activeEdges.add('pub')

        // Travelling stages are exact; resting stages ease into place, which
        // absorbs the small step from an arrival point to a fan slot.
        if (a.x === null || a.stage === 'toQueue' || a.stage === 'toConsumer') {
          a.x = point.x
          a.y = point.y
        } else {
          a.x = lerp(a.x, point.x, 0.16)
          a.y = lerp(a.y, point.y, 0.16)
        }

        const x = clamp(Math.round(a.x - CARD_W / 2), 0, rect.width - CARD_W)
        const y = clamp(Math.round(a.y - CARD_H / 2), 0, rect.height - CARD_H)
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }

      for (const [key, el] of edges) {
        el.classList.toggle('flow-edge-active', activeEdges.has(key))
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })
</script>

<!-- The lines the messages travel along. Drawn beneath the cards. -->
<svg
  class="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
  aria-hidden="true"
>
  <path use:edge={{ key: 'pub' }} class="flow-edge" />
  {#each consumerIds as id (id)}
    <path use:edge={{ key: id }} class="flow-edge" />
  {/each}
</svg>

<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
  {#each flow.packets as packet (packet.id)}
    <PacketCard {packet} {register} />
  {/each}
</div>
