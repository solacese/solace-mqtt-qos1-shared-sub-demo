/**
 * In-flight packet registry — the animation's state machine.
 *
 * A packet's phases mirror real observable broker events, not a timeline we
 * invent. Nothing advances on a guess:
 *
 *   publishing  -> created on publish(); advances when MQTT PUBACK arrives (QoS 1)
 *   queued      -> the message is on the queue; advances when a Solace consumer
 *                  actually delivers it to us
 *   delivering  -> travelling to the consumer that received it (fixed slide time)
 *   processing  -> the consumer's simulated work delay is running
 *   done        -> acknowledge() was called; fades out
 *
 * The only durations we make up are the two slide animations, which are pure
 * presentation. Everything else is driven by a callback from mqtt.js or solclientjs.
 */

export const SLIDE_MS = 620
export const FADE_MS = 420

/** Hard cap on simultaneously rendered cards, so a fast clicker can't wedge the DOM. */
const MAX_PACKETS = 60

let seq = 0

export class FlowStore {
  /** @type {Array<object>} newest last */
  packets = $state([])

  /** id -> packet, for O(1) resolution when a Solace MESSAGE event lands. */
  #byId = new Map()

  /** Messages queued but not yet delivered — drives the queue node's depth badge. */
  queuedCount = $derived(
    this.packets.filter((p) => p.phase === 'queued').length
  )

  nextId() {
    return `m-${++seq}`
  }

  /**
   * Register a packet at the moment of publish. `external: false` means we are
   * the publisher and so we know its key and payload first-hand.
   */
  publish({ id, key, topic, payload, size }) {
    const packet = $state({
      id,
      key,
      topic,
      payload,
      size,
      phase: 'publishing',
      external: false,
      consumerId: null,
      redelivered: false,
      note: null,
      createdAt: performance.now(),
      // Progress ring for the `processing` phase, 0..1.
      progress: 0,
      processingMs: 0,
    })
    this.#insert(packet)
    return packet
  }

  /**
   * PUBACK received: the broker has taken ownership of a QoS 1 message. Now it
   * is genuinely sitting on the queue, so the card comes to rest there.
   */
  acked(id) {
    const p = this.#byId.get(id)
    if (!p) return
    // If the consumer beat the PUBACK to us (entirely possible on localhost),
    // don't drag the card backwards to the queue.
    if (p.phase === 'publishing') p.phase = 'queued'
  }

  /** Publish failed — QoS 1 never completed. Show it rather than leaving a ghost. */
  publishFailed(id, reason) {
    const p = this.#byId.get(id)
    if (!p) return
    p.phase = 'failed'
    p.note = reason
    this.#retire(p, 2400)
  }

  /**
   * A Solace consumer received a message. If we published it, resolve the
   * existing card. If we didn't (queue backlog from before we connected, or a
   * redelivery), create one that enters at the queue node and is tagged
   * `external` — we never silently drop a real message just because it doesn't
   * match something we sent.
   */
  received({ id, key, topic, payload, size, consumerId, redelivered, userProperties }) {
    const existing = id ? this.#byId.get(id) : null
    const p = existing ?? this.#createExternal({ id, key, topic, payload, size, redelivered })

    p.consumerId = consumerId
    p.redelivered = redelivered || p.redelivered
    p.userProperties = userProperties
    // Trust the key the broker actually delivered over the one we think we sent.
    if (key) p.key = key
    p.phase = 'delivering'

    setTimeout(() => {
      if (p.phase === 'delivering') p.phase = 'processing'
    }, SLIDE_MS)

    return p
  }

  /**
   * A message we did not publish: queue backlog from before the UI connected, or
   * a redelivery of something already retired. It enters at the queue node and is
   * tagged, so a real message is never silently dropped from the visualisation.
   */
  #createExternal({ id, key, topic, payload, size, redelivered }) {
    const p = $state({
      id: id || `ext-${++seq}`,
      key,
      topic,
      payload,
      size,
      phase: 'queued',
      external: true,
      consumerId: null,
      redelivered,
      note: redelivered ? 'redelivered' : 'already on queue',
      createdAt: performance.now(),
      progress: 0,
      processingMs: 0,
    })
    this.#insert(p)
    return p
  }

  /**
   * The consumer's simulated work window. Drives the progress ring. Kept in the
   * store rather than the component so a card can outlive a re-render.
   */
  startProcessing(packet, ms) {
    packet.processingMs = ms
    if (ms <= 0) {
      packet.progress = 1
      return
    }
    const start = performance.now()
    const tick = () => {
      if (packet.phase !== 'processing' && packet.phase !== 'delivering') return
      const t = (performance.now() - start) / ms
      packet.progress = Math.min(1, t)
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  /** acknowledge() has been sent to the broker. */
  completed(id) {
    const p = this.#byId.get(id)
    if (!p) return
    p.phase = 'done'
    p.progress = 1
    this.#retire(p, FADE_MS)
  }

  /**
   * A consumer was removed mid-flight. Its cards have nowhere to live, so they
   * are marked and faded instead of hanging off a stale anchor. The broker will
   * redeliver the unacked message to another consumer, which will show up as a
   * fresh `redelivered` card — which is the truthful depiction.
   */
  consumerGone(consumerId) {
    for (const p of this.packets) {
      if (p.consumerId === consumerId && p.phase !== 'done') {
        p.phase = 'orphaned'
        p.note = 'consumer left'
        this.#retire(p, 1200)
      }
    }
  }

  clear() {
    this.packets = []
    this.#byId.clear()
  }

  #insert(packet) {
    this.packets.push(packet)
    this.#byId.set(packet.id, packet)
    // Force-retire the oldest cards rather than letting the layer grow forever.
    while (this.packets.length > MAX_PACKETS) {
      const old = this.packets.shift()
      this.#byId.delete(old.id)
    }
  }

  #retire(packet, after) {
    setTimeout(() => {
      const i = this.packets.indexOf(packet)
      if (i !== -1) this.packets.splice(i, 1)
      this.#byId.delete(packet.id)
    }, after)
  }
}
