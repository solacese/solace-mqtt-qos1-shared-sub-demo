/**
 * The comparison tab's data source: Solace partitioned queues against brokers
 * that do MQTT QoS 1 shared subscriptions natively (EMQX, HiveMQ).
 *
 * This tab is customer-facing, so every factual claim here is either quoted from
 * vendor documentation or observed in this repo's own `verify-interop.mjs` run
 * against a real broker. `sources` on each row names the pages it came from, and
 * the tab renders them as links — a reader should never have to take a claim on
 * trust, and a competitor should not be able to find an easy error.
 *
 * Claims were checked against the docs in August 2026. Vendors ship; re-check
 * before reusing this in front of anyone, and note that EMQX and HiveMQ behave
 * differently from each other on several rows — "MQTT" is not one behaviour.
 *
 * Deliberate choices about tone:
 *  - `verdict` is stated, not implied by giving one column the longer sentence.
 *  - Verdicts are comparative — which product is better on that dimension — not
 *    absolute. A Solace edge can still carry a documented limitation, and where
 *    it does, the limitation is stated in full in the prose (see
 *    `handoff-ordering`, which quotes Solace on key sequences splitting).
 *  - Rows where the competition wins or draws stay in as first-class rows. A
 *    comparison that only lists wins is a pitch, and a customer reads it as one.
 */

/** Every page a claim on this tab came from. */
export const SOURCES = {
  emqx: {
    label: 'EMQX · MQTT shared subscriptions',
    url: 'https://docs.emqx.com/en/emqx/latest/messaging/mqtt-shared-subscription.html',
  },
  hivemq: {
    label: 'HiveMQ · Shared subscriptions',
    url: 'https://docs.hivemq.com/hivemq/latest/user-guide/shared-subscriptions.html',
  },
  queues: {
    label: 'Solace · Queues (partitioned queues)',
    url: 'https://docs.solace.com/Messaging/Guaranteed-Msg/Queues.htm',
  },
  partMsg: {
    label: 'Solace · Message distribution with partitioned queues',
    url: 'https://docs.solace.com/Messaging/Guaranteed-Msg/Partitioned-Queue-Messaging.htm',
  },
  rebalance: {
    label: 'Solace · Partition rebalancing',
    url: 'https://docs.solace.com/Messaging/Guaranteed-Msg/Partition-Rebalancing.htm',
  },
  handoff: {
    label: 'Solace · Partition handoff',
    url: 'https://docs.solace.com/Messaging/Guaranteed-Msg/Partition-Handoff.htm',
  },
  solaceMqtt: {
    label: 'Solace · Using MQTT (shared subscriptions)',
    url: 'https://docs.solace.com/API/MQTT/Using-MQTT.htm',
  },
  kedaSolace: {
    label: 'KEDA · Solace PubSub+ scaler',
    url: 'https://keda.sh/docs/2.17/scalers/solace-pub-sub/',
  },
  kedaCatalog: {
    label: 'KEDA · Scaler catalog',
    url: 'https://keda.sh/docs/2.17/scalers/',
  },
  repo: {
    label: 'This repo · verify-interop.mjs, run against solace-pubsub-standard',
    url: null,
  },
}

export const VERDICTS = {
  solace: {
    label: 'Solace edge',
    chip: 'bg-solace/15 text-solace ring-solace/40',
    rail: 'bg-solace/50',
  },
  mqtt: {
    label: 'MQTT edge',
    chip: 'bg-mqtt/15 text-mqtt ring-mqtt/40',
    rail: 'bg-mqtt/50',
  },
  even: {
    label: 'Even',
    chip: 'bg-slate-500/15 text-slate-300 ring-slate-500/40',
    rail: 'bg-slate-600',
  },
  tradeoff: {
    label: 'Trade-off',
    chip: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
    rail: 'bg-amber-500/50',
  },
}

export const GROUPS = [
  { id: 'routing', label: 'Delivery & routing' },
  { id: 'churn', label: 'Reconnect & rebalance' },
  { id: 'durability', label: 'Durability & observability' },
  { id: 'ops', label: 'Operations & protocol' },
]

/**
 * One row per dimension. `sim` marks the rows the simulation above actually
 * demonstrates, so a reader can tell which claims they can watch happen and
 * which ones rest on the cited docs.
 */
export const DIMENSIONS = [
  {
    id: 'routing-key',
    group: 'routing',
    dimension: 'What the routing decision is made on',
    verdict: 'solace',
    sim: 'publish',
    solace:
      'Any message property the publisher nominates. The broker computes partition = key-hash MOD partition-count, so identical keys always reach the same partition. With no key it picks a random partition.',
    mqtt: 'The choice is between publisher identity and topic string, never a payload field. EMQX offers random, round_robin (default), round_robin_per_group, sticky, local, hash_clientid ("a hash of the publisher\'s Client ID") and hash_topic ("a hash of the publishing topic"). HiveMQ does not key at all: "HiveMQ distributes the messages randomly. A round-robin algorithm is not used."',
    sources: ['queues', 'emqx', 'hivemq'],
  },
  {
    id: 'hash-topic',
    group: 'routing',
    dimension: 'Getting per-key affinity out of topic hashing',
    // hash_topic reaches per-key affinity, so the comparison is not whether it
    // works but what reaching it costs: a topic taxonomy built around routing,
    // and 3 of 4 mappings moving per scaling event against Solace's 1 of 4.
    verdict: 'solace',
    sim: 'strategy',
    solace:
      'Not needed, so the topic taxonomy stays free to model the domain rather than the routing. The key is a property of the message.',
    mqtt: 'EMQX hash_topic reaches per-key affinity, at the cost of building the topic taxonomy around routing: the key must be promoted into the topic string, affinity is per topic rather than per key, and the assignment is a plain modulo over the current subscriber count — so scaling re-routes most topics at once, with no handoff. HiveMQ has no equivalent option.',
    sources: ['emqx', 'hivemq'],
  },
  {
    id: 'qos',
    group: 'routing',
    dimension: 'QoS / delivery guarantee',
    verdict: 'even',
    solace: 'MQTT QoS 1 maps to Guaranteed messaging: the message spools and the broker redelivers it until it is acknowledged. Verified against a real broker in this repo.',
    mqtt: 'Genuine guaranteed delivery, and a real strength. EMQX supports shared subscriptions at QoS 1 and 2. HiveMQ downgrades QoS 2 to QoS 1 inside a shared subscription — "Shared subscriptions with QoS 2 are automatically downgraded to QoS 1" — but QoS 1 is fully supported.',
    sources: ['emqx', 'hivemq', 'repo'],
  },
  {
    id: 'pub-reconnect',
    group: 'churn',
    dimension: 'Publisher reconnect',
    verdict: 'solace',
    sim: 'reconnect',
    solace:
      'A non-event: the publisher\'s identity was never part of the routing decision, so there is no dispatch state to lose and its keys do not move.',
    mqtt: 'EMQX holds dispatch state per publisher connection, and "when a publishing client disconnects and reconnects, this state is reset and reinitialized" — moving that publisher\'s stream to another subscriber under round_robin or sticky. hash_clientid survives only if the client returns with the same Client ID; a generated one (as this demo\'s own publisher uses) does not.',
    sources: ['emqx'],
  },
  {
    id: 'consumer-reconnect',
    group: 'churn',
    dimension: 'Consumer reconnect / assignment continuity',
    verdict: 'solace',
    solace:
      'The API retains the partition set it was given and "sends the mapping information back to the event broker in subsequent bind requests to try to re-establish the same partition mappings", so a consumer that returns inside the rebalance delay resumes its own partitions.',
    mqtt: 'A sticky pin lasts only "until the subscriber disconnects or its session ends", after which a fresh initial pick is made. There is no mapping to reinstate.',
    sources: ['partMsg', 'emqx'],
  },
  {
    id: 'rebalance',
    group: 'churn',
    dimension: 'Rebalancing on scale up/down',
    verdict: 'solace',
    sim: 'scale',
    solace:
      'A formal, acknowledgement-aware handoff. `rebalance delay` waits for the consumer count to stabilise — "if the number of consumers returns to its previous state before the delay timer expires, no partition handoffs occur" — then the broker hands one partition at a time from the busiest flow to the least busy until all flows are within one partition of each other. Delivery from a moving partition is paused and the broker waits up to `rebalance max-handoff-time` for outstanding acks.',
    mqtt: 'No handoff protocol. Under hash_clientid or hash_topic the mapping is a modulo over the live subscriber count, so adding one subscriber re-routes most publishers or topics simultaneously; under sticky the existing pins stay where they are and a newly bound subscriber can simply get nothing.',
    sources: ['rebalance', 'handoff', 'emqx'],
  },
  {
    id: 'handoff-ordering',
    group: 'churn',
    dimension: 'Per-key ordering during a rebalance',
    // Comparative, like every other verdict in this column: Solace bounds the
    // exposure with a handoff window and an ack timer, a shared subscription
    // does not bound it at all. The limitation itself stays stated in full.
    verdict: 'solace',
    solace:
      'Not absolute, and Solace documents it: if a partition moves while a key sequence still has undelivered messages, "a key sequence can therefore split across consumers". The recommended mitigations are to externalise state or to "acknowledge only after receiving the last message in a sequence" — which "doesn\'t eliminate the problem, but it reduces the size of the window". "The recovery methods in these cases are application specific."',
    mqtt: 'The same exposure, with nothing bounding it — no handoff window, no ack timer, and under modulo strategies far more keys move per scaling event.',
    sources: ['handoff'],
  },
  {
    id: 'no-consumer',
    group: 'durability',
    dimension: 'Durability when no consumer is connected',
    verdict: 'solace',
    solace:
      'The queue is a durable, administratively provisioned endpoint. It spools whether or not anything is bound — the queues in this demo exist before any client connects, which is why the app refuses to provision them.',
    mqtt: 'HiveMQ queues for a standard shared subscription only "As long as at least one subscribed client session exists", capped at 500,000 messages per shared subscription. A *declared* shared subscription is "enqueued even if there are no connected shared subscribers for the topic", but has to be preconfigured. On EMQX, "when the last session expires, all pending messages will be discarded."',
    sources: ['hivemq', 'emqx'],
  },
  {
    id: 'visibility',
    group: 'durability',
    dimension: 'Consumer visibility into its assignment',
    verdict: 'even',
    solace:
      'At the wire level the broker "returns the set of assigned partitions to the client in the bind response" — but the API consumes that internally for reconnect continuity. The application "has no knowledge of which partition a message was delivered from, and has no means to request messages from any particular partition". It does see the publisher\'s key.',
    mqtt: 'No visibility either: the dispatch decision is internal broker state, and nothing is returned to the subscriber.',
    sources: ['partMsg', 'emqx'],
  },
  {
    id: 'keda',
    group: 'ops',
    dimension: 'Kubernetes autoscaling (KEDA)',
    verdict: 'solace',
    solace:
      'A `solace-event-queue` scaler ships in KEDA\'s official catalog (community-maintained, available since KEDA 2.4). It scales on `messageCountTarget`, `messageSpoolUsageTarget` and `messageReceiveRateTarget`; KEDA\'s own docs note that count alone "can cause flapping" and receive rate alone "cannot scale consumers based on queue backlog", so combine them. A newly bound consumer then triggers a partition rebalance broker-side.',
    mqtt: 'KEDA\'s catalog contains no MQTT, EMQX, HiveMQ or Mosquitto scaler at all. You would scale on a proxy metric or write and maintain your own.',
    sources: ['kedaSolace', 'kedaCatalog'],
  },
  {
    id: 'admin',
    group: 'ops',
    dimension: 'Admin / config overhead',
    verdict: 'tradeoff',
    solace:
      'Partition count and the key property are broker-side settings, so the routing contract is not compiled into applications. But changing the partition count is "service affecting" — drain first — and partitioned queues do not support browsing, selectors, replay, XA transactions or REST Delivery Point bindings.',
    mqtt: 'Genuinely lighter: one setting (`mqtt.shared_subscription_strategy`) that applies immediately with no client-side changes, and no queue to provision at all. Fewer moving parts, and correspondingly fewer levers when per-key correctness starts to matter.',
    sources: ['queues', 'emqx'],
  },
  {
    id: 'protocol',
    group: 'ops',
    dimension: 'Consumer protocol',
    verdict: 'mqtt',
    solace:
      'The publisher stays on MQTT and needs no changes, but the consumer must move to SMF, JMS or AMQP: MQTT subscribers "do not have the ability to bind to an arbitrary queue". Solace\'s own MQTT shared subscriptions are QoS 0 only — "if a shared subscription with a higher QoS is requested, it is downgraded to QoS 0" — and are "supported only on non-durable sessions". MQTT 3.1.1 publishers also cannot set a partition key.',
    mqtt: 'MQTT end-to-end. If avoiding a protocol split is the constraint you are actually optimising for, this is the row that decides it.',
    sources: ['queues', 'solaceMqtt'],
  },
]

/** Verdict tallies for the scoreboard, so they cannot drift from the rows. */
export function tally() {
  const counts = {}
  for (const v of Object.keys(VERDICTS)) counts[v] = 0
  for (const d of DIMENSIONS) counts[d.verdict]++
  return counts
}
