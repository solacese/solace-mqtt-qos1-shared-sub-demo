/**
 * Demo mode: the app running with no broker at all.
 *
 * On by default, so opening the page shows the pattern working instead of two
 * disconnected panels and an empty stage. The moment you click Connect on either
 * side, the real client takes over — `connect()` calls `exitSimulated()` on the
 * store, and `enabled` here is derived from those flags rather than tracked
 * separately, so it cannot get out of step.
 *
 * What is simulated is narrow and stated on screen: the transport and the
 * acknowledgement. Everything the demo is actually about still runs for real —
 * the key rotation, the topic template, the MQTT 5 user properties, the flow
 * phase machine, the per-consumer work delay, pausing holding a message unacked,
 * and the partition routing rule itself.
 *
 * The routing rule is the one thing worth being careful about, because it is the
 * claim the whole app makes. Both queue behaviours are modelled exactly as the
 * broker documents them:
 *
 *   partitioned     partition = key-hash MOD partitionCount, one partition owned
 *                   by one consumer — so a key sticks
 *   non-exclusive   the next available consumer takes the message — so keys
 *                   scatter across all of them
 */

import { fnv1a } from './keyColor.js'
import { SLIDE_MS } from './flow.svelte.js'

/** Long enough for the card to reach the queue node before a consumer takes it. */
const DELIVER_AFTER_MS = SLIDE_MS + 260

export class DemoMode {
  /** 'partitioned' | 'non-exclusive' — which queue behaviour to model. */
  queueMode = $state('partitioned')
  partitionCount = $state(4)

  /** Auto-publish a steady trickle, so the stage is alive without clicking. */
  streaming = $state(true)
  intervalMs = $state(1700)

  #publisher
  #consumers
  #log
  #rr = 0
  #timers = new Set()

  constructor({ publisher, consumers, log }) {
    this.#publisher = publisher
    this.#consumers = consumers
    this.#log = log
  }

  /**
   * Derived from the stores rather than held here, so a real connect() silently
   * turning off the simulation cannot leave this flag stale.
   */
  enabled = $derived(this.#publisher.simulated || this.#consumers.simulated)

  enable() {
    this.#consumers.connectSimulated()
    this.#publisher.connectSimulated()
  }

  disable() {
    this.#clearTimers()
    this.#publisher.exitSimulated()
    this.#consumers.exitSimulated()
    this.#log.info('mqtt', 'Demo mode off — connect a real broker on either side')
  }

  /** Publish one simulated message and route it like the chosen queue would. */
  publishOnce() {
    if (!this.enabled) return
    const packet = this.#publisher.publish()
    if (!packet) return

    this.#after(DELIVER_AFTER_MS, () => {
      const target = this.#route(packet.key)
      if (!target) {
        // Nothing bound, or everything paused. The card stays at the queue node,
        // which is exactly what a real broker would leave you looking at.
        return
      }
      this.#consumers.deliverSimulated(target, {
        id: packet.id,
        key: packet.key,
        topic: packet.topic,
        payload: packet.payload,
        userProperties: {
          demoMsgId: packet.id,
          ...(packet.key ? { [this.#consumers.config.partitionKeyProperty]: packet.key } : {}),
          simulated: 'true',
        },
      })
    })
  }

  /**
   * Which consumer takes this message.
   *
   * A paused consumer is skipped, because pausing calls `stop()` on a real flow
   * and the broker hands the message to a sibling instead. On a partitioned
   * queue that is not true of the partition owner — the messages for that
   * partition wait — so a paused owner returns nothing and the card sits at the
   * queue, which is the honest picture.
   */
  #route(key) {
    const live = this.#consumers.consumers.filter((c) => c.state === 'up' || c.state === 'paused')
    if (!live.length) return null

    if (this.queueMode === 'partitioned') {
      // No key means a random partition — the broker's documented behaviour, and
      // why the publisher's "No key" mode cannot demonstrate stickiness.
      const partition =
        key == null
          ? Math.floor(Math.random() * this.partitionCount)
          : fnv1a(key) % this.partitionCount
      // Partitions spread over the bound flows, the same even split the broker
      // aims for: every flow within one partition of every other.
      const owner = live[partition % live.length]
      return owner.paused ? null : owner.id
    }

    // Non-exclusive: the next consumer that can actually take it.
    for (let i = 0; i < live.length; i++) {
      const c = live[(this.#rr + i) % live.length]
      if (!c.paused) {
        this.#rr = (this.#rr + i + 1) % live.length
        return c.id
      }
    }
    return null
  }

  /**
   * The auto-publish loop. Returns a teardown, so callers can drive it straight
   * from an `$effect` and never leak a timer.
   */
  startStream() {
    const id = setInterval(() => this.publishOnce(), this.intervalMs)
    return () => clearInterval(id)
  }

  #after(ms, fn) {
    const t = setTimeout(() => {
      this.#timers.delete(t)
      fn()
    }, ms)
    this.#timers.add(t)
    return t
  }

  #clearTimers() {
    for (const t of this.#timers) clearTimeout(t)
    this.#timers.clear()
  }
}
