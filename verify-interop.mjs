/**
 * Headless check of the premise the UI is built on — no browser required:
 *   1. an MQTT 5 client can publish QoS 1 into a Solace queue
 *   2. its User Properties arrive in the SMF user property map
 *   3. QUEUE_PARTITION_KEY drives partition stickiness on a partitioned queue
 *
 *   node verify-interop.mjs                        # non-exclusive queue
 *   node verify-interop.mjs q/orders-partitioned   # partitioned queue
 *
 * Env: SOLACE_URL, MQTT_URL, VPN, USERNAME, PASSWORD, TOPIC_SUB
 */
import mqtt from 'mqtt'
import solace from 'solclientjs'

const QUEUE = process.argv[2] ?? 'q/orders'
const SOLACE_URL = process.env.SOLACE_URL ?? 'ws://localhost:8008'
const MQTT_URL = process.env.MQTT_URL ?? 'ws://localhost:8000'
const VPN = process.env.VPN ?? 'default'
const USERNAME = process.env.USERNAME ?? 'default'
const PASSWORD = process.env.PASSWORD ?? ''
const TOPIC_SUB = process.env.TOPIC_SUB ?? 'orders/>'
const CONSUMERS = 3
const KEYS = ['order-1', 'order-2', 'order-3', 'order-4']
const ROUNDS = 3

const props = new solace.SolclientFactoryProperties()
props.profile = solace.SolclientFactoryProfiles.version10_5
solace.SolclientFactory.init(props)
solace.SolclientFactory.setLogLevel(solace.LogLevel.ERROR)

/**
 * Only messages that arrive after the settle window are measured. Anything
 * already spooled on the queue is drained and discarded first, because partition
 * ownership shifts while consumers are still joining: consumer 1 briefly owns all
 * four partitions, then gives some up as 2 and 3 arrive. Backlog delivered during
 * those intermediate states genuinely does land on several consumers per key, and
 * counting it would make a correctly-partitioned queue look scattered.
 */
let measuring = false
const received = []
let drained = 0

const session = solace.SolclientFactory.createSession({
  url: SOLACE_URL,
  vpnName: VPN,
  userName: USERNAME,
  password: PASSWORD,
})

await new Promise((resolve, reject) => {
  session.on(solace.SessionEventCode.UP_NOTICE, resolve)
  session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e) => reject(new Error(e.message)))
  session.connect()
})
console.log('session up')

const consumers = []
for (let i = 0; i < CONSUMERS; i++) {
  const label = `consumer-${i + 1}`
  const c = session.createMessageConsumer({
    queueDescriptor: { name: QUEUE, type: solace.QueueType.QUEUE, durable: true },
    acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
    createIfMissing: false,
    windowSize: 1,
  })
  c.on(solace.MessageConsumerEventName.MESSAGE, (m) => {
    const up = {}
    const map = m.getUserPropertyMap()
    if (map) for (const k of map.getKeys()) up[k] = String(map.getField(k)?.getValue())
    let body = m.getBinaryAttachment()
    if (body && typeof body !== 'string') body = new TextDecoder().decode(body)
    if (measuring) {
      received.push({ label, topic: m.getDestination().getName(), userProperties: up, body })
    } else {
      drained++
    }
    m.acknowledge()
  })
  await new Promise((resolve, reject) => {
    c.on(solace.MessageConsumerEventName.UP, resolve)
    c.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, (e) =>
      reject(new Error(`${label}: ${e.message} subcode=${e.subcode}`))
    )
    c.connect()
  })
  if (i === 0) {
    await new Promise((resolve) => {
      c.on(solace.MessageConsumerEventName.SUBSCRIPTION_OK, resolve)
      c.on(solace.MessageConsumerEventName.SUBSCRIPTION_ERROR, (e) => {
        console.log(`  subscription note: subcode=${e.subcode}`)
        resolve()
      })
      c.addSubscription(solace.SolclientFactory.createTopicDestination(TOPIC_SUB), 'k', 5000)
    })
  }
  consumers.push(c)
}
console.log(`${CONSUMERS} consumers bound to "${QUEUE}"`)

// A partitioned queue does not deliver anything until the broker has assigned
// partitions to the newly-joined consumers, which takes up to the queue's
// partitionRebalanceDelay. Publishing before that just spools.
const SETTLE_MS = 8000
console.log(`waiting ${SETTLE_MS}ms for partition rebalancing to settle and backlog to drain…`)
await new Promise((r) => setTimeout(r, SETTLE_MS))
if (drained) console.log(`discarded ${drained} pre-existing message(s) from the queue`)
measuring = true

const client = await new Promise((resolve, reject) => {
  const c = mqtt.connect(MQTT_URL, {
    protocolVersion: 5,
    clientId: `verify-${Math.random().toString(36).slice(2, 8)}`,
    username: USERNAME,
    password: PASSWORD || undefined,
    clean: true,
    reconnectPeriod: 0,
    properties: { sessionExpiryInterval: 0 },
  })
  c.on('connect', (p) => {
    console.log(`mqtt5 connected, broker maximumQoS=${p?.properties?.maximumQoS ?? 'n/a'}`)
    resolve(c)
  })
  c.on('error', reject)
})

let n = 0
for (let round = 0; round < ROUNDS; round++) {
  for (const key of KEYS) {
    const id = `m-${++n}`
    await new Promise((resolve, reject) =>
      client.publish(
        `orders/${key}/created`,
        JSON.stringify({ demoMsgId: id, partitionKey: key }),
        { qos: 1, properties: { userProperties: { QUEUE_PARTITION_KEY: key, demoMsgId: id } } },
        (e) => (e ? reject(e) : resolve())
      )
    )
  }
}
console.log(`published ${n} QoS 1 messages`)

await new Promise((r) => setTimeout(r, 6000))

console.log(`\nreceived ${received.length}/${n} of the messages published in this run`)
const first = received[0]
console.log('\nfirst message user property map:', JSON.stringify(first?.userProperties ?? {}, null, 2))
console.log(
  `QUEUE_PARTITION_KEY present in SMF user properties: ${
    first && 'QUEUE_PARTITION_KEY' in first.userProperties ? 'YES' : 'NO'
  }`
)

const byConsumer = {}
const keyToConsumers = {}
for (const r of received) {
  byConsumer[r.label] = (byConsumer[r.label] ?? 0) + 1
  const k = r.userProperties.QUEUE_PARTITION_KEY ?? JSON.parse(r.body || '{}').partitionKey
  ;(keyToConsumers[k] ??= new Set()).add(r.label)
}
console.log('\ndistribution across consumers:', byConsumer)
console.log('key -> consumers that saw it:')
for (const [k, set] of Object.entries(keyToConsumers)) {
  console.log(`  ${k}: ${[...set].join(', ')}${set.size === 1 ? '   (sticky)' : '   (scattered)'}`)
}

client.end(true)
for (const c of consumers) c.dispose()
session.disconnect()
process.exit(0)
