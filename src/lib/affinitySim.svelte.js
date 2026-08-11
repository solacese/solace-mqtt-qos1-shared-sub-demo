/**
 * Dispatch simulation for the comparison tab.
 *
 * Two broker models, driven side by side from one set of controls so the
 * comparison is genuinely apples to apples:
 *
 *   'shared-sub'  a native MQTT QoS 1 shared subscription. Every dispatch
 *                 strategy here is a real, documented one, named exactly as the
 *                 vendor names it — see STRATEGIES below.
 *   'partition'   a Solace partitioned queue. The broker hashes a property of
 *                 the *message* onto a partition, and each partition is owned by
 *                 exactly one bound consumer flow.
 *
 * The strategy is selectable because a single hardcoded rule would be a straw
 * man. EMQX's `hash_topic` genuinely does give per-key affinity if you put the
 * key in the topic, and this panel shows it doing so — a customer-facing
 * comparison that hid that would be worth nothing the moment somebody who knows
 * EMQX looked at it. What the panel then shows is what that costs.
 *
 * IMPORTANT: this is a model, not a client. Nothing here talks to a broker,
 * unlike the live demo tab where every phase transition comes from a real
 * mqtt.js or solclientjs callback. The panel says so on screen.
 *
 * The rules below are transcriptions of documented behaviour:
 *   EMQX    https://docs.emqx.com/en/emqx/latest/messaging/mqtt-shared-subscription.html
 *   HiveMQ  https://docs.hivemq.com/hivemq/latest/user-guide/shared-subscriptions.html
 *   Solace  https://docs.solace.com/Messaging/Guaranteed-Msg/Queues.htm
 *           https://docs.solace.com/Messaging/Guaranteed-Msg/Partition-Rebalancing.htm
 */

import { fnv1a } from './keyColor.js'

export const KEYS = ['order-1', 'order-2', 'order-3', 'order-4']
export const PUBLISHERS = ['pub-A', 'pub-B']
export const PARTITION_COUNT = 4

/** The live demo's default topic template, so both tabs tell the same story. */
export function topicOf(key) {
  return `orders/${key}/created`
}

/**
 * The documented shared-subscription strategies.
 *
 * `affinity` is what the strategy can promise about a single key:
 *   'none'      any consumer, any message
 *   'publisher' consistent per publisher, so a key splits once per publisher
 *   'key'       consistent per key — the one that matches a partitioned queue
 */
export const STRATEGIES = {
  round_robin: {
    label: 'round_robin',
    vendor: 'EMQX default',
    rule: 'consumer = next(position[publisher])',
    affinity: 'none',
    note: 'A distinct round-robin position is held per publishing client, so nothing about a key is consistent. This is the default.',
  },
  random: {
    label: 'random',
    vendor: 'HiveMQ behaviour · EMQX option',
    rule: 'consumer = random()',
    affinity: 'none',
    note: 'HiveMQ has no keyed option at all: it "distributes the messages randomly" and states that "a round-robin algorithm is not used".',
  },
  sticky: {
    label: 'sticky',
    vendor: 'EMQX option',
    rule: 'consumer = pinned(publisher session)',
    affinity: 'publisher',
    note: 'Pins a publisher to one subscriber "until the subscriber disconnects or its session ends" — consistent per publisher, never per key. The initial pick is random, so two publishers may happen to share a subscriber or may split every key between two.',
  },
  hash_clientid: {
    label: 'hash_clientid',
    vendor: 'EMQX option',
    rule: 'consumer = hash(publisher ClientID) MOD n',
    affinity: 'publisher',
    note: 'Hashes the publisher\'s Client ID. Deterministic per publisher — but the message key plays no part, so a key shared by two publishers still lands in two places.',
  },
  hash_topic: {
    label: 'hash_topic',
    vendor: 'EMQX option',
    rule: 'consumer = hash(topic) MOD n',
    affinity: 'key',
    note: 'Reaches per-key affinity by hashing the topic, so it depends on the key having been promoted into the topic string. Affinity is per topic rather than per key, and the mapping is a plain modulo over the live subscriber count — so scaling re-routes most topics at once, with no handoff.',
  },
}

/** One leg of a message's journey: publisher → broker, or broker → consumer. */
export const HOP_MS = 560
/** Time a message rests at the broker before the routing decision is shown. */
const BROKER_HOLD_MS = 220
/** How long a landed message stays visible on its consumer. */
const LAND_MS = 300
/**
 * Stand-in for the queue's `rebalance delay`, which Solace describes as "the
 * delay in seconds to allow the number of consumers to stabilize before a
 * rebalance activity is started after being triggered". Real default is seconds;
 * compressed here so the panel stays watchable.
 */
const REBALANCE_MS = 1600
/** Hard cap on rendered chips, so leaving the tab running can't grow the DOM. */
const MAX_MESSAGES = 18

/** Which partition a key lands on: partition = key-hash MOD partition-count. */
export function partitionOf(key) {
  return fnv1a(key) % PARTITION_COUNT
}

export class DispatchSim {
  /** @type {'shared-sub' | 'partition'} */
  model

  /** shared-sub only. One of the keys of STRATEGIES. */
  strategy = $state('round_robin')

  /** @type {Array<{id: string, label: string, count: number, keys: object, flash: boolean}>} */
  consumers = $state([])

  /** In-flight and just-landed messages. */
  messages = $state([])

  /** Partitioned queue only: a rebalance is running, so delivery is paused. */
  rebalancing = $state(false)

  /** Transient banner — a reconnect result, a rebalance outcome. */
  flash = $state(null)

  /**
   * Publisher session generation. MQTT clients very commonly reconnect with a
   * freshly generated Client ID — this demo's own publisher does — so the
   * modelled Client ID carries the generation, and `hash_clientid` therefore
   * rehashes on reconnect. A client that pins a stable Client ID would not, and
   * the panel says so.
   */
  session = $state({})

  /** sticky: publisher -> consumer id. */
  pinned = $state({})

  /** round_robin: publisher -> its own rotation position. */
  position = $state({})

  /** partition model: partition number -> consumer id. */
  owner = $state({})

  #cseq = 0
  #seq = 0
  #timers = new Set()
  #rebalanceToken = 0

  constructor(model, consumerCount = 3) {
    this.model = model
    for (let i = 0; i < consumerCount; i++) this.#addConsumer()
    for (const pub of PUBLISHERS) {
      this.session[pub] = 1
      this.position[pub] = 0
    }
    if (model === 'partition') this.#rebalance()
  }

  /** The Client ID this publisher is currently connected with. */
  clientId(pub) {
    return `${pub}#${this.session[pub] ?? 1}`
  }

  // ---- what the routing rule can promise --------------------------------

  get affinity() {
    return this.model === 'partition' ? 'key' : STRATEGIES[this.strategy].affinity
  }

  get rule() {
    return this.model === 'partition'
      ? `partition = hash(partition key) MOD ${PARTITION_COUNT}`
      : STRATEGIES[this.strategy].rule
  }

  /**
   * Which consumers can be handling a given key at the same time.
   *
   * Read out of the routing rule rather than from delivery history, so it is a
   * statement about the model and not about which messages happen to have gone
   * through yet. 'none' affinity means *any* bound consumer — which is the
   * honest answer for round_robin and random, not a worst case.
   */
  ownersOf(key) {
    const ids = this.consumers.map((c) => c.id)
    if (!ids.length) return []

    if (this.model === 'partition') {
      const id = this.owner[partitionOf(key)]
      return id ? [id] : []
    }

    switch (this.strategy) {
      case 'hash_topic':
        return [ids[fnv1a(topicOf(key)) % ids.length]]
      case 'hash_clientid':
        return [...new Set(PUBLISHERS.map((p) => ids[fnv1a(this.clientId(p)) % ids.length]))]
      case 'sticky':
        return [...new Set(PUBLISHERS.map((p) => this.pinned[p]).filter((id) => ids.includes(id)))]
      default:
        // random and round_robin: every bound consumer is a candidate.
        return ids
    }
  }

  ownership = $derived(
    KEYS.map((key) => ({
      key,
      topic: topicOf(key),
      partition: partitionOf(key),
      owners: this.ownersOf(key),
    }))
  )

  /** Keys that can be in flight to more than one consumer at once. */
  splitKeys = $derived(this.ownership.filter((o) => o.owners.length > 1).map((o) => o.key))

  /**
   * A one-line description of what currently routes to this consumer, for its
   * node label. Lives here rather than in the component so there is exactly one
   * implementation of each routing rule.
   */
  bindingFor(id) {
    const ids = this.consumers.map((c) => c.id)

    if (this.model === 'partition') {
      const ps = Object.entries(this.owner)
        .filter(([, owner]) => owner === id)
        .map(([p]) => Number(p))
        .sort((a, b) => a - b)
      return ps.length ? `p${ps.join(' p')}` : 'no partitions'
    }

    switch (this.strategy) {
      case 'hash_topic': {
        const mine = KEYS.filter((k) => this.ownersOf(k)[0] === id)
        return mine.length ? mine.map((k) => k.replace('order-', 'o')).join(' ') : 'no topics'
      }
      case 'sticky':
      case 'hash_clientid': {
        const mine = PUBLISHERS.filter((p) =>
          this.strategy === 'sticky'
            ? this.pinned[p] === id
            : ids.length > 0 && ids[fnv1a(this.clientId(p)) % ids.length] === id
        )
        return mine.length ? mine.join(' ') : 'no publisher'
      }
      default:
        return 'in rotation'
    }
  }

  /**
   * Keys this consumer is the *sole* owner of.
   *
   * Empty when the rule has no per-key affinity, because then every consumer is a
   * candidate for every key and no colour would be truthful. That is why the
   * round_robin and random panels stay uncoloured while the partitioned one does
   * not — the absence is the finding.
   */
  ownedKeys(id) {
    return this.ownership.filter((o) => o.owners.length === 1 && o.owners[0] === id).map((o) => o.key)
  }

  /** Consumers the routing rule can never reach, however many messages you send. */
  idleConsumers = $derived.by(() => {
    const reachable = new Set(this.ownership.flatMap((o) => o.owners))
    return this.consumers.filter((c) => !reachable.has(c.id)).map((c) => c.id)
  })

  // ---- driving it -------------------------------------------------------

  publish(key, pub) {
    const msg = $state({
      id: `s-${++this.#seq}`,
      key,
      pub,
      // 'atPub' exists purely so the chip is painted at the publisher for one
      // frame before its position changes — otherwise the CSS transition has
      // nothing to travel from and the chip appears at the broker.
      stage: 'atPub',
      target: null,
      redelivered: false,
    })
    this.messages.push(msg)
    while (this.messages.length > MAX_MESSAGES) this.messages.shift()

    requestAnimationFrame(() => {
      if (msg.stage !== 'atPub') return
      msg.stage = 'toBroker'
      this.#after(HOP_MS, () => {
        msg.stage = 'atBroker'
        this.#after(BROKER_HOLD_MS, () => this.#dispatch(msg))
      })
    })
    return msg
  }

  setStrategy(next) {
    if (!STRATEGIES[next] || this.model !== 'shared-sub') return
    this.strategy = next
    // EMQX makes the sticky pick when a publisher's first message arrives. Pin
    // eagerly so the readout below states the steady state rather than showing
    // every consumer as unreachable until the next publish.
    if (next === 'sticky') {
      for (const pub of PUBLISHERS) {
        if (!this.consumers.some((c) => c.id === this.pinned[pub])) this.#claimSticky(pub)
      }
    }
    // EMQX applies a strategy change immediately, with no client-side change.
    this.#flashNote(
      STRATEGIES[next].affinity === 'key' ? 'good' : 'bad',
      `strategy = ${next} — applied immediately, no client changes`
    )
  }

  /**
   * A publisher's session drops and comes straight back with a new Client ID.
   *
   * EMQX keeps dispatch state per publisher connection: "when a publishing
   * client disconnects and reconnects, this state is reset and reinitialized."
   * On a partitioned queue there is nothing to reset, because the publisher's
   * identity was never an input to the routing decision.
   */
  reconnect(pub) {
    // Captured before the session changes, or the "before" would already be the
    // post-reconnect answer.
    const before = this.ownersOf(KEYS[0])
    this.session[pub] = (this.session[pub] ?? 1) + 1

    if (this.model === 'partition') {
      this.#flashNote(
        'good',
        `${pub} reconnected — its identity is not an input to routing, so nothing moved`
      )
      return
    }

    switch (this.strategy) {
      case 'round_robin':
        this.position[pub] = 0
        this.#flashNote('bad', `${pub} dispatch position reset and reinitialised`)
        break
      case 'sticky': {
        const was = this.pinned[pub]
        delete this.pinned[pub]
        this.#claimSticky(pub)
        this.#flashNote(
          'bad',
          `${pub} pin lost with its session — re-picked ${was ?? '—'} → ${this.pinned[pub] ?? '—'}`
        )
        break
      }
      case 'hash_clientid': {
        const after = this.ownersOf(KEYS[0])
        this.#flashNote(
          'bad',
          `${pub} returned as ${this.clientId(pub)} — new Client ID rehashes ` +
            `(${before.join(',')} → ${after.join(',')}). A pinned Client ID would not move.`
        )
        break
      }
      case 'hash_topic':
        this.#flashNote('good', `${pub} reconnected — hash_topic ignores publisher identity`)
        break
      default:
        this.#flashNote('bad', `${pub} reconnected — random dispatch has no affinity to preserve`)
    }
  }

  addConsumer() {
    if (this.consumers.length >= 6) return
    const c = this.#addConsumer()
    if (this.model === 'partition') {
      this.#beginRebalance(`${c.label} bound — rebalance delay running, delivery paused`)
      return
    }
    switch (this.strategy) {
      case 'hash_clientid':
      case 'hash_topic':
        // n changed, so the modulo changed: no handoff, just a re-route.
        this.#flashNote(
          'bad',
          `${c.label} bound — MOD ${this.consumers.length} re-routes immediately, with no handoff`
        )
        break
      case 'sticky':
        this.#flashNote('bad', `${c.label} bound — existing pins stay put, so it gets nothing`)
        break
      default:
        this.#flashNote('bad', `${c.label} bound — joins the rotation; still no per-key affinity`)
    }
  }

  removeConsumer() {
    if (this.consumers.length <= 1) return
    const gone = this.consumers.pop()

    if (this.model === 'partition') {
      for (const p of Object.keys(this.owner)) {
        if (this.owner[p] === gone.id) delete this.owner[p]
      }
      this.#beginRebalance(`${gone.label} left — rebalancing its partitions`)
    } else {
      for (const pub of PUBLISHERS) {
        if (this.pinned[pub] === gone.id) this.#claimSticky(pub)
      }
      this.#flashNote('bad', `${gone.label} left — remaining assignments shift with no handoff`)
    }

    // Anything in flight to it is unacked, so the broker gives it to somebody
    // else. Same as the live demo: it returns as a redelivery, not a loss.
    for (const msg of this.messages) {
      if (msg.target === gone.id && msg.stage !== 'landed') {
        msg.target = null
        msg.redelivered = true
        msg.stage = 'spooled'
      }
    }
    this.#flushSpooled()
  }

  reset() {
    for (const c of this.consumers) {
      c.count = 0
      c.keys = {}
    }
    this.messages = []
  }

  dispose() {
    for (const t of this.#timers) clearTimeout(t)
    this.#timers.clear()
  }

  // ---- routing ----------------------------------------------------------

  /** The routing decision itself. Everything visible follows from this. */
  route(key, pub) {
    const ids = this.consumers.map((c) => c.id)
    if (!ids.length) return null

    if (this.model === 'partition') {
      // Delivery from a moving partition is paused during a handoff.
      if (this.rebalancing) return null
      return this.owner[partitionOf(key)] ?? null
    }

    switch (this.strategy) {
      case 'hash_topic':
        return ids[fnv1a(topicOf(key)) % ids.length]
      case 'hash_clientid':
        return ids[fnv1a(this.clientId(pub)) % ids.length]
      case 'sticky':
        if (!ids.includes(this.pinned[pub])) this.#claimSticky(pub)
        return this.pinned[pub] ?? null
      case 'round_robin': {
        const at = this.position[pub] ?? 0
        this.position[pub] = at + 1
        return ids[at % ids.length]
      }
      default:
        return ids[Math.floor(Math.random() * ids.length)]
    }
  }

  #dispatch(msg) {
    const target = this.route(msg.key, msg.pub)
    if (!target) {
      // Solace pauses delivery from a partition being handed off and the
      // messages "remain in the queue" — which is why they stack up here.
      msg.stage = 'spooled'
      return
    }
    msg.target = target
    msg.stage = 'toConsumer'
    this.#after(HOP_MS, () => this.#land(msg))
  }

  #land(msg) {
    const c = this.consumers.find((x) => x.id === msg.target)
    if (!c) {
      msg.stage = 'spooled'
      this.#flushSpooled()
      return
    }
    c.count++
    c.keys[msg.key] = (c.keys[msg.key] ?? 0) + 1
    c.flash = true
    c.flashKey = msg.key
    this.#after(LAND_MS, () => {
      c.flash = false
      c.flashKey = null
    })

    msg.stage = 'landed'
    this.#after(LAND_MS, () => {
      const i = this.messages.indexOf(msg)
      if (i !== -1) this.messages.splice(i, 1)
    })
  }

  #flushSpooled() {
    for (const msg of [...this.messages]) {
      if (msg.stage === 'spooled') this.#dispatch(msg)
    }
  }

  // ---- assignment strategies --------------------------------------------

  /**
   * sticky: EMQX's initial pick is governed by
   * `mqtt.shared_subscription_initial_sticky_pick`, default `random`.
   */
  #claimSticky(pub) {
    const ids = this.consumers.map((c) => c.id)
    if (!ids.length) return
    this.pinned[pub] = ids[Math.floor(Math.random() * ids.length)]
  }

  #beginRebalance(note) {
    const token = ++this.#rebalanceToken
    this.rebalancing = true
    this.#flashNote('good', note)
    this.#after(REBALANCE_MS, () => {
      if (token !== this.#rebalanceToken) return
      this.rebalancing = false
      this.#rebalance()
      this.#flushSpooled()
    })
  }

  /**
   * Solace's documented rebalance: "Balance has been achieved if all flows have
   * the same number of partitions assigned (plus or minus one)", reached by
   * handing "one partition from the flow with the greatest number of assigned
   * partitions to the flow with the least". A partition whose owner is still
   * within its share is left exactly where it is — which is the whole value of a
   * formal handoff over a modulo, where every mapping changes at once.
   */
  #rebalance() {
    const ids = this.consumers.map((c) => c.id)
    if (!ids.length) {
      this.owner = {}
      return
    }

    const base = Math.floor(PARTITION_COUNT / ids.length)
    const extra = PARTITION_COUNT % ids.length
    const target = {}
    const held = {}
    ids.forEach((id, i) => {
      target[id] = base + (i < extra ? 1 : 0)
      held[id] = []
    })

    const unowned = []
    for (let p = 0; p < PARTITION_COUNT; p++) {
      const o = this.owner[p]
      if (o && held[o]) held[o].push(p)
      else unowned.push(p)
    }

    for (const id of ids) {
      while (held[id].length > target[id]) unowned.push(held[id].pop())
    }
    for (const id of ids) {
      while (held[id].length < target[id] && unowned.length) held[id].push(unowned.shift())
    }

    const next = {}
    for (const id of ids) for (const p of held[id]) next[p] = id
    this.owner = next
  }

  // ---- plumbing ---------------------------------------------------------

  #addConsumer() {
    const n = ++this.#cseq
    const c = $state({
      id: `c${n}`,
      label: `consumer-${n}`,
      count: 0,
      keys: {},
      flash: false,
      /** Key of the message that just landed, so the flash can match its colour. */
      flashKey: null,
    })
    this.consumers.push(c)
    return c
  }

  #flashNote(tone, text) {
    this.flash = { tone, text }
    const mine = this.flash
    this.#after(4200, () => {
      if (this.flash === mine) this.flash = null
    })
  }

  #after(ms, fn) {
    const t = setTimeout(() => {
      this.#timers.delete(t)
      fn()
    }, ms)
    this.#timers.add(t)
    return t
  }
}
