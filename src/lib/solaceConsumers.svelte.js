/**
 * The Solace SMF side: one session, N MessageConsumers bound to the same queue.
 *
 * This is what the demo is really about. Solace only permits MQTT shared
 * subscriptions at QoS 0 on non-durable sessions, so MQTT alone cannot give you
 * load-balanced *guaranteed* delivery. Binding several SMF consumers to one
 * non-exclusive (or partitioned) queue does — and the publisher never has to know.
 *
 * Per Solace docs, "AMQP and MQTT clients can publish to (but not consume from)
 * partitioned queues", which is exactly the topology here.
 */

import solace from 'solclientjs'
import { load, save, randomSuffix } from './persist.js'

// One-time factory init. Must happen before any other solclientjs call.
const factoryProps = new solace.SolclientFactoryProperties()
factoryProps.profile = solace.SolclientFactoryProfiles.version10_5
solace.SolclientFactory.init(factoryProps)
solace.SolclientFactory.setLogLevel(solace.LogLevel.WARN)

export const SOLACE_DEFAULTS = {
  url: 'ws://localhost:8008',
  vpnName: 'default',
  userName: 'default',
  password: '',
  queueName: 'q/orders',
  topicSubscription: 'orders/>',
  addSubscription: true,
  partitionKeyProperty: 'QUEUE_PARTITION_KEY',
  windowSize: 1,
  consumerCount: 3,
  processingDelayMs: 1200,
  drainOnConnect: true,
}

/**
 * There is no broker event for "the queue is empty now", so quiescence is the
 * signal: this long without a delivery means the backlog is gone.
 */
const DRAIN_QUIET_MS = 1200
/** Ceiling, so a queue somebody else is still publishing to can't stall the demo. */
const DRAIN_MAX_MS = 20000
/** The drain wants throughput; the demo consumers deliberately want the opposite. */
const DRAIN_WINDOW = 255

let consumerSeq = 0

/** One bound consumer: its own solclientjs MessageConsumer plus demo-visible state. */
class Consumer {
  id
  label
  state = $state('connecting') // connecting | up | down | paused | disposed
  receivedCount = $state(0)
  keysSeen = $state([]) // distinct partition keys, in first-seen order
  lastMessage = $state(null)
  paused = $state(false)
  delayMs = $state(SOLACE_DEFAULTS.processingDelayMs)
  error = $state(null)
  /** Mirrors #held.length so the UI can react to it. */
  heldCount = $state(0)

  /** @type {import('solclientjs').MessageConsumer} */ raw = null
  /** Messages held back while paused, acked as soon as we resume. */
  #held = []

  constructor(id, label, delayMs) {
    this.id = id
    this.label = label
    this.delayMs = delayMs
  }

  noteMessage(key) {
    this.receivedCount++
    const k = key ?? '(no key)'
    if (!this.keysSeen.includes(k)) this.keysSeen.push(k)
  }

  hold(fn) {
    this.#held.push(fn)
    this.heldCount = this.#held.length
  }

  releaseHeld() {
    const held = this.#held
    this.#held = []
    this.heldCount = 0
    for (const fn of held) fn()
  }
}

export class SolaceConsumers {
  config = $state(load('solace', SOLACE_DEFAULTS))
  status = $state('disconnected') // disconnected | connecting | draining | connected | error
  error = $state(null)
  consumers = $state([])
  /** Set once we've successfully mapped the topic onto the queue. */
  subscriptionAdded = $state(false)
  /** Messages discarded by the pre-flight drain, for the UI to show. */
  drainedCount = $state(0)

  /**
   * Demo mode: consumers exist in memory only, with no solclientjs flow behind
   * them. Deliveries arrive via `deliverSimulated` and join the same path a real
   * message takes, so pause, work delay, key colouring and the phase machine are
   * all genuine. Only the transport is fabricated.
   */
  simulated = $state(false)

  #session = null
  #log
  #flow
  /** Guards addSubscription so only the first consumer attempts it. */
  #subscriptionClaimed = false
  /** Set while the pre-flight drain is running, so disconnect can abort it. */
  #cancelDrain = null

  constructor({ log, flow }) {
    this.#log = log
    this.#flow = flow
  }

  get connected() {
    return this.status === 'connected'
  }

  /** The queue is being emptied of its pre-existing backlog; nothing is bound yet. */
  get draining() {
    return this.status === 'draining'
  }

  /** True from the moment connect() is called until disconnect(), drain included. */
  get busy() {
    return this.status === 'connecting' || this.status === 'draining' || this.status === 'connected'
  }

  get totalReceived() {
    return this.consumers.reduce((n, c) => n + c.receivedCount, 0)
  }

  // ---------------------------------------------------------------- session

  /**
   * Bring consumers up without a broker. No drain: there is no spool to empty,
   * and pretending to drain one would be theatre.
   */
  connectSimulated() {
    if (this.#session) this.disconnect()
    this.simulated = true
    this.status = 'connected'
    this.error = null
    this.drainedCount = 0
    this.subscriptionAdded = false
    this.consumers = []
    // Captured first: addConsumer writes config.consumerCount, so reading it as
    // the loop bound would stop after one.
    const target = Math.max(1, this.config.consumerCount)
    for (let i = 0; i < target; i++) this.addConsumer(false)
    this.#log.info(
      'solace',
      `Demo mode — ${this.consumers.length} simulated consumers, no Solace broker is involved`
    )
  }

  /** Drop simulated state so a real connection can take over. */
  exitSimulated() {
    if (!this.simulated) return
    this.simulated = false
    for (const c of this.consumers) this.#flow.consumerGone(c.id)
    this.consumers = []
    this.status = 'disconnected'
  }

  async connect() {
    // A real session always wins over the simulation.
    this.exitSimulated()
    if (this.#session) this.disconnect()
    save('solace', this.config)
    this.status = 'connecting'
    this.error = null
    this.subscriptionAdded = false
    this.#subscriptionClaimed = false
    this.drainedCount = 0

    const { url, vpnName, userName, password } = this.config
    this.#log.info('solace', `Connecting session to ${url} (vpn "${vpnName}")`)

    let session
    try {
      session = solace.SolclientFactory.createSession({
        url,
        vpnName,
        userName,
        password,
        clientName: `solace-sub-${randomSuffix()}`,
        reconnectRetries: 0,
        connectTimeoutInMsecs: 8000,
      })
    } catch (e) {
      this.status = 'error'
      this.error = e.message
      this.#log.error('solace', `Could not create session: ${e.message}`)
      return
    }

    this.#session = session

    session.on(solace.SessionEventCode.UP_NOTICE, async () => {
      this.error = null
      this.#log.ok('solace', 'Session up')

      // Empty the queue before a single demo consumer is bound, so the animation
      // starts from a known-empty state.
      if (this.config.drainOnConnect) {
        this.status = 'draining'
        await this.#drain()
        // The user may have hit Disconnect, or the session may have gone down,
        // while the drain was running. Either way this connect attempt is over,
        // and binding consumers now would resurrect a dead one.
        if (this.#session !== session || this.status !== 'draining') return
      }

      this.status = 'connected'
      // Verified against a real broker: on a *partitioned* queue nothing is
      // delivered until the broker has assigned partitions to the newly-joined
      // consumers, which takes up to the queue's partition rebalance delay
      // (5s by default). Messages published before then simply spool, which
      // looks like a broken demo unless you know to expect it.
      this.#log.info(
        'solace',
        'On a partitioned queue, allow a few seconds after binding for partition rebalancing before publishing — until partitions are assigned, messages just spool on the queue.'
      )
      // Only now can consumers be bound.
      this.setConsumerCount(this.config.consumerCount)
    })

    session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e) => {
      this.status = 'error'
      this.error = describe(e)
      this.#log.error('solace', `Connect failed: ${describe(e)}`)
      this.#hintForSubcode(e)
    })

    session.on(solace.SessionEventCode.DISCONNECTED, () => {
      this.status = 'disconnected'
      this.#log.info('solace', 'Session disconnected')
      this.#cancelDrain?.()
      this.#disposeAll()
      if (this.#session) {
        this.#session.dispose()
        this.#session = null
      }
    })

    session.on(solace.SessionEventCode.DOWN_ERROR, (e) => {
      this.status = 'error'
      this.error = describe(e)
      this.#log.error('solace', `Session down: ${describe(e)}`)
      this.#cancelDrain?.()
    })

    try {
      session.connect()
    } catch (e) {
      this.status = 'error'
      this.error = e.message
      this.#log.error('solace', `connect() threw: ${e.message}`)
    }
  }

  disconnect() {
    this.#cancelDrain?.()
    this.#disposeAll()
    const session = this.#session
    this.#session = null
    if (session) {
      try {
        session.disconnect()
      } catch {
        /* already gone */
      }
    }
    this.status = 'disconnected'
    this.subscriptionAdded = false
    this.#subscriptionClaimed = false
  }

  // --------------------------------------------------------------- consumers

  /** Grow or shrink the consumer pool to `n`, live. */
  setConsumerCount(n) {
    const target = Math.max(0, Math.min(12, Math.floor(n)))
    this.config.consumerCount = target
    if (!this.connected) return
    // The initial bind is not a rebalance worth narrating — only a consumer
    // joining an already-running pool is.
    while (this.consumers.length < target) this.addConsumer(false)
    while (this.consumers.length > target) this.removeConsumer()
  }

  addConsumer(announceRebalance = true) {
    if (!this.simulated && (!this.#session || this.status !== 'connected')) {
      this.#log.warn('solace', 'Session is not up — cannot bind a consumer')
      return
    }

    const id = `c-${++consumerSeq}`
    const consumer = new Consumer(id, `Consumer ${this.consumers.length + 1}`, this.config.processingDelayMs)

    if (this.simulated) {
      // No flow to create, so it is up immediately. Demo mode's router decides
      // what reaches it.
      consumer.state = 'up'
      this.consumers.push(consumer)
      this.config.consumerCount = this.consumers.length
      if (announceRebalance && this.consumers.length > 1) {
        this.#log.info('solace', `${consumer.label} bound (simulated) — partitions rebalance`)
      }
      return
    }

    let raw
    try {
      raw = this.#session.createMessageConsumer({
        queueDescriptor: { name: this.config.queueName, type: solace.QueueType.QUEUE, durable: true },
        // CLIENT ack is what makes the simulated work delay meaningful: the
        // broker cannot consider the message handled until we say so.
        acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
        // Never create the queue from the browser. The queue's access type
        // (non-exclusive) and partition count are the whole point of the demo
        // and belong in broker config, not in a client's provisioning request.
        createIfMissing: false,
        // Load-bearing. The API default is 255, which lets the first consumer
        // buffer the entire stream locally and makes load balancing invisible.
        // A small window keeps messages on the queue where the broker can
        // distribute them.
        windowSize: clampWindow(this.config.windowSize),
      })
    } catch (e) {
      this.#log.error('solace', `Could not create consumer: ${e.message}`)
      return
    }

    consumer.raw = raw

    const isJoiningExisting = announceRebalance && this.consumers.length > 0

    raw.on(solace.MessageConsumerEventName.UP, () => {
      consumer.state = consumer.paused ? 'paused' : 'up'
      this.#log.ok('solace', `${consumer.label} bound to "${this.config.queueName}"`)
      if (isJoiningExisting) {
        this.#log.info(
          'solace',
          'A consumer joining or leaving a partitioned queue triggers a rebalance — expect a short pause before this consumer starts receiving.'
        )
      }
      this.#claimSubscription(consumer)
    })

    raw.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, (e) => {
      consumer.state = 'down'
      consumer.error = describe(e)
      this.#log.error('solace', `${consumer.label} could not bind: ${describe(e)}`)
      this.#hintForSubcode(e)
    })

    raw.on(solace.MessageConsumerEventName.DOWN_ERROR, (e) => {
      consumer.state = 'down'
      consumer.error = describe(e)
      this.#log.error('solace', `${consumer.label} down: ${describe(e)}`)
    })

    raw.on(solace.MessageConsumerEventName.GM_DISABLED, () => {
      consumer.state = 'down'
      consumer.error = 'Guaranteed messaging disabled on this message VPN'
      this.#log.error(
        'solace',
        'Guaranteed messaging is disabled on the message VPN — a queue cannot be bound, and MQTT QoS 1 will be downgraded to QoS 0.'
      )
    })

    raw.on(solace.MessageConsumerEventName.SUBSCRIPTION_OK, () => {
      this.subscriptionAdded = true
      this.#log.ok('solace', `Subscription "${this.config.topicSubscription}" mapped onto the queue`)
    })

    raw.on(solace.MessageConsumerEventName.SUBSCRIPTION_ERROR, (e) => {
      const subcode = e?.subcode
      if (subcode === solace.ErrorSubcode.SUBSCRIPTION_ALREADY_PRESENT) {
        // Benign and expected on a re-run, or when the queue was pre-configured.
        this.subscriptionAdded = true
        this.#log.info('solace', `Subscription "${this.config.topicSubscription}" was already on the queue`)
        return
      }
      this.#log.error('solace', `Adding subscription failed: ${describe(e)}`)
      // PERMISSION_NOT_ALLOWED is by far the most common cause in practice: a
      // queue whose permission is only `consume` cannot have subscriptions added
      // to it by a client. It needs `modify-topic`.
      if (subcode === solace.ErrorSubcode.PERMISSION_NOT_ALLOWED) {
        this.#log.warn(
          'solace',
          `Queue "${this.config.queueName}" does not permit clients to add subscriptions. Set its permission to "modify-topic" in PubSub+ Manager, or add "${this.config.topicSubscription}" to the queue yourself and untick "Add this subscription".`
        )
      } else if (subcode === solace.ErrorSubcode.SUBSCRIPTION_ACL_DENIED) {
        this.#log.warn(
          'solace',
          `The client username "${this.config.userName}" is denied this topic by an ACL profile.`
        )
      }
    })

    raw.on(solace.MessageConsumerEventName.MESSAGE, (message) => {
      this.#onMessage(consumer, message)
    })

    raw.on(solace.MessageConsumerEventName.DISPOSED, () => {
      consumer.state = 'disposed'
    })

    this.consumers.push(consumer)

    try {
      raw.connect()
    } catch (e) {
      consumer.state = 'down'
      consumer.error = e.message
      this.#log.error('solace', `${consumer.label} connect() threw: ${e.message}`)
    }
  }

  removeConsumer(id = null) {
    const index = id ? this.consumers.findIndex((c) => c.id === id) : this.consumers.length - 1
    if (index < 0) return
    const [consumer] = this.consumers.splice(index, 1)
    this.config.consumerCount = this.consumers.length
    this.#dispose(consumer)
    this.#log.info('solace', `${consumer.label} removed — its unacked messages will be redelivered elsewhere`)
    // Its in-flight cards have no anchor any more.
    this.#flow.consumerGone(consumer.id)
  }

  togglePause(id) {
    const consumer = this.consumers.find((c) => c.id === id)
    if (!consumer) return
    consumer.paused = !consumer.paused
    if (consumer.paused) {
      // Stop the flow of new messages at the API level, so the broker sends the
      // backlog to the other consumers instead of it piling up locally.
      try {
        consumer.raw?.stop()
      } catch {
        /* not up yet */
      }
      consumer.state = 'paused'
      this.#log.info('solace', `${consumer.label} paused`)
    } else {
      try {
        consumer.raw?.start()
      } catch {
        /* not up yet */
      }
      consumer.state = 'up'
      consumer.releaseHeld()
      this.#log.info('solace', `${consumer.label} resumed`)
    }
  }

  setDelay(id, ms) {
    const consumer = this.consumers.find((c) => c.id === id)
    if (consumer) consumer.delayMs = ms
  }

  /** Apply the panel-level default delay to every existing consumer. */
  applyDelayToAll(ms) {
    this.config.processingDelayMs = ms
    for (const c of this.consumers) c.delayMs = ms
  }

  // ----------------------------------------------------------------- internal

  /**
   * Consume and acknowledge everything already spooled on the queue, before a
   * single demo consumer is bound.
   *
   * A queue that survived a previous run almost always still holds messages, and
   * the demo consumers would be handed that backlog the instant they come up: the
   * flow layer fills with cards for messages nobody published in this session,
   * every one of them tagged "already on queue", and the load-balancing story the
   * demo exists to tell is buried under a burst of animation before the first
   * publish. So a single throwaway consumer eats the backlog first — a large flow
   * window, no processing delay, nothing registered with the flow store.
   *
   * Draining is best effort. If the consumer cannot bind (missing queue, denied
   * permission, guaranteed messaging off) we log it, hint at the cause, and let
   * the normal bind attempt fail in the same way it always would — that path
   * already reports itself per consumer, and swallowing the connect here would
   * only hide it.
   */
  #drain() {
    return new Promise((resolve) => {
      const queueName = this.config.queueName
      this.#log.info('solace', `Draining any backlog on "${queueName}" before binding consumers`)

      let raw
      try {
        raw = this.#session.createMessageConsumer({
          queueDescriptor: { name: queueName, type: solace.QueueType.QUEUE, durable: true },
          acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
          createIfMissing: false,
          windowSize: DRAIN_WINDOW,
        })
      } catch (e) {
        this.#log.error('solace', `Could not create the drain consumer: ${e.message}`)
        resolve()
        return
      }

      let quiet = null
      let ceiling = null
      let settled = false

      const finish = (summary) => {
        if (settled) return
        settled = true
        clearTimeout(quiet)
        clearTimeout(ceiling)
        this.#cancelDrain = null
        try {
          raw.disconnect()
        } catch {
          /* may never have come up */
        }
        try {
          raw.dispose()
        } catch {
          /* already disposed */
        }
        if (summary) this.#log[summary.level]('solace', summary.message)
        // Cards resting at the queue node were published before we bound, so the
        // drain just consumed them. Leaving them on screen would claim they are
        // still waiting for a consumer that will never see them.
        if (this.drainedCount > 0) this.#flow.clearPending()
        resolve()
      }

      // Each delivery pushes the finish line back; a quiet window means empty.
      const bumpQuiet = () => {
        clearTimeout(quiet)
        quiet = setTimeout(() => {
          finish({
            level: this.drainedCount > 0 ? 'ok' : 'info',
            message: this.drainedCount
              ? `Drained ${this.drainedCount} message${this.drainedCount === 1 ? '' : 's'} from "${queueName}" — starting from an empty queue`
              : `Queue "${queueName}" was already empty`,
          })
        }, DRAIN_QUIET_MS)
      }

      raw.on(solace.MessageConsumerEventName.UP, bumpQuiet)

      raw.on(solace.MessageConsumerEventName.MESSAGE, (message) => {
        this.drainedCount++
        try {
          message.acknowledge()
        } catch (e) {
          this.#log.error('solace', `Drain acknowledge() failed: ${e.message}`)
        }
        bumpQuiet()
      })

      raw.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, (e) => {
        this.#log.error('solace', `Drain consumer could not bind: ${describe(e)}`)
        this.#hintForSubcode(e)
        finish(null)
      })

      raw.on(solace.MessageConsumerEventName.DOWN_ERROR, (e) => {
        this.#log.error('solace', `Drain consumer down: ${describe(e)}`)
        finish(null)
      })

      raw.on(solace.MessageConsumerEventName.GM_DISABLED, () => {
        finish({
          level: 'error',
          message:
            'Guaranteed messaging is disabled on the message VPN — the queue cannot be bound, so there is nothing to drain.',
        })
      })

      this.#cancelDrain = () => finish({ level: 'info', message: 'Drain cancelled' })

      try {
        raw.connect()
      } catch (e) {
        this.#log.error('solace', `Drain consumer connect() threw: ${e.message}`)
        finish(null)
      }

      // A queue that someone else is actively publishing to never goes quiet.
      // Give up rather than hold the demo hostage to it.
      ceiling = setTimeout(() => {
        finish({
          level: 'warn',
          message: `Still receiving after ${DRAIN_MAX_MS / 1000}s — "${queueName}" is being published to from elsewhere. Binding consumers now; ${this.drainedCount} message${this.drainedCount === 1 ? '' : 's'} drained so far.`,
        })
      }, DRAIN_MAX_MS)
    })
  }

  /**
   * Map the MQTT topic onto the queue exactly once. Every consumer binding to
   * the same queue would otherwise race to add the same subscription, producing
   * a flurry of SUBSCRIPTION_ALREADY_PRESENT errors.
   */
  #claimSubscription(consumer) {
    if (!this.config.addSubscription) return
    if (this.#subscriptionClaimed) return
    this.#subscriptionClaimed = true
    const topic = this.config.topicSubscription?.trim()
    if (!topic) return
    try {
      consumer.raw.addSubscription(
        solace.SolclientFactory.createTopicDestination(topic),
        `sub-${consumer.id}`,
        5000
      )
      this.#log.info('solace', `Adding subscription "${topic}" to queue "${this.config.queueName}"`)
    } catch (e) {
      this.#subscriptionClaimed = false
      this.#log.error('solace', `addSubscription threw: ${e.message}`)
    }
  }

  /**
   * A simulated delivery, from demo mode rather than from a broker.
   *
   * It joins the *same* path a real message takes — `#accept` below — so the
   * phase machine, the key colouring, the pause/hold behaviour and the work
   * delay are the genuine ones. Only the transport and the acknowledgement are
   * fabricated.
   */
  deliverSimulated(consumerId, { id, key, topic, payload, userProperties }) {
    const consumer = this.consumers.find((c) => c.id === consumerId)
    if (!consumer) return
    this.#accept(
      consumer,
      {
        id,
        key,
        topic,
        bodyText: payload,
        userProperties,
        propertyKeyPresent: key != null,
        redelivered: false,
      },
      // Nothing to acknowledge to. The flow store is still told, so the card
      // completes on the consumer's real work delay.
      () => {}
    )
  }

  #onMessage(consumer, message) {
    const payload = readPayload(message)
    const userProperties = readUserProperties(message)
    const topic = message.getDestination()?.getName() ?? '(unknown)'
    const redelivered = message.isRedelivered?.() ?? false

    // Prefer the partition key as it actually arrived in the SMF user property
    // map — that is the fact this demo exists to show. Fall back to the payload
    // copy only so the UI still has something to colour by if the property did
    // not survive the MQTT->SMF hop.
    const propKey = userProperties[this.config.partitionKeyProperty]
    const bodyKey = payload.json?.partitionKey ?? null
    const key = propKey ?? bodyKey ?? null
    const id = payload.json?.demoMsgId ?? userProperties.demoMsgId ?? null

    if (propKey === undefined && bodyKey) {
      this.#log.warn(
        'solace',
        `"${this.config.partitionKeyProperty}" was not in the received user properties (saw: ${Object.keys(userProperties).join(', ') || 'none'}). Colouring by the payload copy instead.`
      )
    }

    this.#accept(
      consumer,
      {
        id,
        key,
        topic,
        bodyText: payload.text,
        userProperties,
        propertyKeyPresent: propKey !== undefined,
        redelivered,
      },
      () => message.acknowledge()
    )
  }

  /**
   * Everything that happens once a message is in hand, regardless of how it got
   * here: record it on the consumer, register it with the flow store, run the
   * simulated work delay, then acknowledge — or hold it unacked if the consumer
   * is paused, which is the honest depiction of a stalled worker.
   */
  #accept(consumer, { id, key, topic, bodyText, userProperties, propertyKeyPresent, redelivered }, ackFn) {
    consumer.noteMessage(key)
    consumer.lastMessage = {
      topic,
      key,
      propertyKeyPresent,
      userProperties,
      body: bodyText,
      redelivered,
      receivedAt: new Date().toLocaleTimeString(),
    }

    const packet = this.#flow.received({
      id,
      key,
      topic,
      payload: bodyText,
      size: bodyText.length,
      consumerId: consumer.id,
      redelivered,
      userProperties,
    })

    this.#log.info(
      'solace',
      `${consumer.label} received ${topic}${key ? ` [key=${key}]` : ''}${redelivered ? ' (redelivered)' : ''}${this.simulated ? ' (simulated)' : ''}`
    )

    const ack = () => {
      try {
        ackFn()
        this.#flow.completed(packet.id)
      } catch (e) {
        this.#log.error('solace', `acknowledge() failed: ${e.message}`)
      }
    }

    // The simulated work window. A paused consumer holds its message unacked,
    // which is the honest depiction of a stalled worker.
    const delay = Math.max(0, consumer.delayMs)
    this.#flow.startProcessing(packet, delay)

    setTimeout(() => {
      if (consumer.paused) {
        consumer.hold(ack)
        return
      }
      ack()
    }, delay)
  }

  #dispose(consumer) {
    try {
      consumer.raw?.disconnect()
    } catch {
      /* may not be up */
    }
    try {
      consumer.raw?.dispose()
    } catch {
      /* already disposed */
    }
    consumer.state = 'disposed'
  }

  #disposeAll() {
    for (const c of this.consumers) this.#dispose(c)
    this.consumers = []
  }

  /** Turn the most common binding failures into something actionable. */
  #hintForSubcode(e) {
    const sub = e?.subcode
    const S = solace.ErrorSubcode
    if (sub === S.UNKNOWN_QUEUE_NAME || sub === S.QUEUE_NOT_FOUND) {
      this.#log.warn(
        'solace',
        `Queue "${this.config.queueName}" does not exist. Create it in PubSub+ Manager as a durable, non-exclusive queue (optionally with a partition count) — this app never provisions queues.`
      )
    } else if (sub === S.LOGIN_FAILURE || sub === S.INVALID_SESSION_OPERATION) {
      this.#log.warn('solace', 'Check the message VPN name, client username and password.')
    } else if (sub === S.CONNECTION_ERROR || sub === S.TIMEOUT) {
      this.#log.warn(
        'solace',
        'No SMF-over-WebSocket connection. Local broker default is ws://localhost:8008; Solace Cloud uses the secured web-messaging URI (wss://…:443).'
      )
    }
  }
}

// ------------------------------------------------------------------ helpers

function clampWindow(n) {
  const v = Math.floor(Number(n) || 1)
  return Math.max(1, Math.min(255, v))
}

/** Message payload, whichever of the two SMF payload slots it arrived in. */
function readPayload(message) {
  let text = ''
  try {
    const bin = message.getBinaryAttachment()
    if (bin) {
      text = typeof bin === 'string' ? bin : new TextDecoder().decode(bin)
    } else {
      // An SMF publisher may have used the XML/SDT slot instead.
      text = message.getSdtContainer()?.getValue?.() ?? ''
    }
  } catch {
    text = '(unreadable payload)'
  }
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON — fine, the demo still works, just without correlation */
  }
  return { text, json: json && typeof json === 'object' ? json : null }
}

/** Flatten the SMF user property map into a plain object for display. */
function readUserProperties(message) {
  const out = {}
  try {
    const map = message.getUserPropertyMap()
    if (!map) return out
    for (const key of map.getKeys()) {
      const value = map.getField(key)?.getValue()
      out[key] = value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value)
    }
  } catch {
    /* nothing usable */
  }
  return out
}

function describe(e) {
  if (!e) return 'unknown error'
  const parts = [e.message || e.infoStr || String(e)]
  if (e.subcode !== undefined) parts.push(`subcode ${subcodeName(e.subcode)}`)
  if (e.responseCode) parts.push(`response ${e.responseCode}`)
  return parts.join(', ')
}

let subcodeNames = null
function subcodeName(code) {
  if (!subcodeNames) {
    subcodeNames = new Map()
    for (const [name, value] of Object.entries(solace.ErrorSubcode)) {
      if (typeof value === 'number' || typeof value === 'string') subcodeNames.set(value, name)
    }
  }
  return subcodeNames.get(code) ?? code
}
