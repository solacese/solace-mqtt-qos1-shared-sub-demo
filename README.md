# MQTT → Solace Interop Demo

A visual demonstration that you can **publish with MQTT 5 at QoS 1** and **consume the same messages
with the Solace API**, load-balanced across several consumers bound to a **non-exclusive** or
**partitioned** queue.

```
 MQTT config │              the flow stage               │ Solace config
─────────────┼──────────────────────────────────────────┼───────────────
             │                            ╭───────────╮ │
             │  ┌────────┐   ┌─────────┐ ╱│Consumer 1 │ │  Consumer 1
  url, topic │  │ MQTT 5 │┈┈▶│ q/orders│╱ │  order-4  │ │   delay ▁▂▃
  keys, body │  │  Pub   │   │    6    │──▶│Consumer 2 │ │   pause  ✕
  payload    │  └────────┘   │ awaiting│╲ │  order-1  │ │
             │      ▔▔▔▔     └─────────┘ ╲│Consumer 3 │ │  Consumer 2
             │   publish once   the hub   ╰───────────╯ │   delay ▁▂▃
             │                             static nodes │   pause  ✕
```

The middle is a **pure visualisation**: the publisher, the queue and each consumer are static nodes,
joined by the lines that messages actually travel along. All configuration lives in the flanking
panels, so nothing on the stage moves or resizes while you are watching a message cross it.

Colour-coded cards ride those lines, driven by real client callbacks — nothing on screen is on a timer
pretending to be a broker.

## Why this demo exists

Solace permits MQTT shared subscriptions only at **QoS 0 on non-durable sessions**. So MQTT alone
cannot give you load-balanced *guaranteed* delivery. Binding several Solace SMF consumers to one
queue does — and the MQTT publisher needs no changes and no knowledge of the consumers.

Add a **partitioned** queue and you also get per-key ordering affinity: every message carrying the
same partition key is handled by the same consumer, so you can scale out without losing per-entity
ordering.

## Quick start

```bash
npm install
npm run dev          # then open the printed URL
```

You need a Solace broker. Locally:

```bash
docker run -d --name=solace --shm-size=2g \
  -p 8080:8080 -p 55555:55555 -p 8008:8008 -p 8000:8000 \
  solace/solace-pubsub-standard
```

### Broker setup

Create the queues in PubSub+ Manager (`http://localhost:8080`, `admin`/`admin`). **This app never
provisions queues** — access type and partition count are the whole point of the demo and belong in
broker configuration, not in a browser client's provisioning request.

| Queue | Access type | Partition count | Permission |
|---|---|---|---|
| `q/orders` | non-exclusive | 0 | **modify-topic** |
| `q/orders-partitioned` | non-exclusive | 4 | **modify-topic** |

Or via SEMP:

```bash
curl -u admin:admin -X POST http://localhost:8080/SEMP/v2/config/msgVpns/default/queues \
  -H 'Content-Type: application/json' \
  -d '{"queueName":"q/orders","accessType":"non-exclusive","permission":"modify-topic",
       "egressEnabled":true,"ingressEnabled":true}'

curl -u admin:admin -X POST http://localhost:8080/SEMP/v2/config/msgVpns/default/queues \
  -H 'Content-Type: application/json' \
  -d '{"queueName":"q/orders-partitioned","accessType":"non-exclusive","permission":"modify-topic",
       "egressEnabled":true,"ingressEnabled":true,"partitionCount":4,"partitionRebalanceDelay":5}'
```

> **`permission` must be `modify-topic`, not `consume`.** With `consume`, the app's attempt to map the
> MQTT topic onto the queue fails with subcode `125 PERMISSION_NOT_ALLOWED`. The alternative is to add
> the `orders/>` subscription to the queue yourself and untick *"Add this subscription"* in the UI.

### Ports

| Purpose | Plaintext | TLS | Notes |
|---|---|---|---|
| MQTT over WebSocket | `ws://host:8000` | `wss://host:8443` | the publisher |
| SMF over WebSocket | `ws://host:8008` | `wss://host:443` | the consumers |
| SEMP / PubSub+ Manager | `http://host:8080` | — | queue setup only |

Solace Cloud: take the **MQTT WebSocket** and **Secured Web Messaging** URIs from the service's
Connect tab. Both libraries run in the browser over WebSocket, so there is no backend and no CORS
involved.

## Running the demo

1. **Connect the Solace side first** (`ws://localhost:8008`, VPN `default`, queue `q/orders`). Three
   consumers bind and the topic subscription is mapped onto the queue.
2. **Connect the MQTT side** (`ws://localhost:8000`).
3. **Publish.** A card travels the line from the publisher to the queue, rests below the queue node
   until a consumer actually receives it, then travels that consumer's line and shows a progress ring
   for its simulated work time before being acknowledged. The line currently carrying a message
   brightens and its dashes animate.
4. Open **Last msg** on a consumer in the right-hand panel to see the received SMF user property map
   verbatim — this is where you can see `QUEUE_PARTITION_KEY` arriving from an MQTT publisher.

The number on the queue node is labelled **awaiting consumer**, not "queue depth", on purpose: it
counts only the messages this UI has published or seen that have not yet been handed to a consumer.
The broker's real spool can hold messages this UI never published, and reading that would need the
management API.

**To contrast the two queue types:** run with `q/orders` and watch the key colours scatter across all
consumers, then disconnect, switch to `q/orders-partitioned`, reconnect and publish again — each key
colour now sticks to one consumer, and the *keys seen* chips on each consumer card stay disjoint.

### Things that make the demo work

- **Flow window size 1.** The solclientjs default is 255, which lets the first consumer buffer the
  entire stream locally so the broker never gets a chance to distribute anything. A window of 1 keeps
  messages on the queue where they can be balanced. This is the single most common reason a
  load-balancing demo appears to do nothing.
- **Give partitioned queues time to rebalance.** Nothing is delivered until the broker assigns
  partitions to the newly-joined consumers, which takes up to the queue's `partitionRebalanceDelay`
  (5s by default). Messages published before then just spool. Adding or removing a consumer triggers
  another rebalance.
- **Start from an empty queue when demonstrating stickiness.** Partition ownership shifts *while*
  consumers are joining — consumer 1 briefly owns all four partitions before giving some up. Backlog
  delivered during that window really does land on several consumers per key, which makes a correctly
  partitioned queue look scattered. Messages the UI didn't publish are tagged *"already on queue"* on
  their card so you can tell them apart.
- **Set a processing delay** (1–2s) before publishing a burst. With instant acknowledgement the
  distribution is still correct but too fast to watch.

### If messages stop being delivered

The symptom is nasty because everything reports as healthy: the publisher gets its PUBACK, the cards
reach the queue node and stay there, and all consumers show as *up* with a count of zero.

The usual cause is **orphaned consumer flows from a previous page load**. A closed or reloaded tab
leaves its flows bound on the broker until it times them out; on a non-exclusive queue those flows
keep taking their turn and never acknowledge anything, so messages are handed to a consumer that no
longer exists, sit unacked, and are then requeued. The app disconnects its clients on `pagehide` /
`beforeunload` to prevent this, but an abruptly killed browser can still leave them behind.

To confirm, count the egress flows on the queue — there should be exactly one per consumer you can
see in the UI:

```bash
curl -s -u admin:admin \
  http://localhost:8080/SEMP/v2/monitor/msgVpns/default/queues/q%2Forders/txFlows \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; \
    print(len(d),'flows:',sorted({f['clientName'] for f in d}))"
```

More than one distinct `clientName` means there is a stale session. Wait for the broker to time it
out, or delete and recreate the queue.

Two SEMP gotchas worth knowing while debugging this, both of which produced convincingly wrong
answers: an invalid `?select=` field makes SEMP return **400 with no `data`**, which is easy to
mistake for "zero flows"; and `spooledMsgCount` is a **cumulative** counter since queue creation, not
the current depth — use `msgSpoolUsage` for that.

## What was verified against a real broker

The Solace documentation describes SMF→MQTT user-property mapping explicitly but is silent on the
MQTT→SMF direction, so this was tested rather than assumed. `verify-interop.mjs` is a headless check
that needs no browser:

```bash
npm run verify              # non-exclusive queue
npm run verify:partitioned  # partitioned queue
```

Results against `solace/solace-pubsub-standard`:

```
QUEUE_PARTITION_KEY present in SMF user properties: YES

# q/orders (non-exclusive)
distribution: { consumer-1: 4, consumer-2: 4, consumer-3: 4 }
  order-1: consumer-1, consumer-2, consumer-3   (scattered)
  order-2: consumer-1, consumer-2, consumer-3   (scattered)

# q/orders-partitioned (4 partitions, 3 consumers)
distribution: { consumer-1: 3, consumer-2: 3, consumer-3: 6 }
  order-1: consumer-3   (sticky)
  order-2: consumer-1   (sticky)
  order-3: consumer-2   (sticky)
  order-4: consumer-3   (sticky)
```

So, confirmed empirically:

1. **MQTT 5 User Properties do reach SMF consumers** in the user property map.
2. **`QUEUE_PARTITION_KEY` set by an MQTT publisher does drive Solace partition assignment**, matching
   the documented statement that "AMQP and MQTT clients can publish to (but not consume from)
   partitioned queues".
3. MQTT QoS 1 maps to Guaranteed delivery, so the messages spool and can be balanced.
4. With 4 partitions across 3 consumers one consumer owns two partitions — hence the 3/3/6 split.
   That is correct partitioning, not imbalance.

## Partition keys

| Client | How the partition key is set |
|---|---|
| MQTT 5 | User Property `QUEUE_PARTITION_KEY` (what this app does) |
| SMF | user property `QUEUE_PARTITION_KEY` |
| JMS | the `JMSXGroupID` property |

If no partition key is present, Solace assigns the message to a **random** partition — which is why
the *No key* mode in the publisher shows a warning: it cannot demonstrate stickiness.

The property name is an editable field on both panels rather than a hard-coded constant, and every
received user property is displayed, so a broker version that behaves differently shows you what it
actually did instead of silently producing a misleading picture.

## How the visualisation stays honest

The broker's internal partition assignment is not observable from a client, so the app never invents
partition numbers or slot animations. Instead each card is coloured by a stable hash of its partition
key, and each consumer lists the distinct keys it has genuinely received. Stickiness is therefore
*measured*, not illustrated.

Each logical phase transition is triggered by a real event:

| Phase | Advanced by |
|---|---|
| `publishing` | the MQTT PUBACK callback (QoS 1) |
| `queued` | a Solace consumer actually delivering the message |
| `delivering` | travel duration (presentation only) |
| `processing` | the consumer's configured work delay |
| `done` | `message.acknowledge()` being sent |

A card's **visual** stage is tracked separately from that logical phase. A PUBACK on localhost lands
in about a millisecond, so if the card's position were driven straight off the phase it would teleport
to the queue before you saw it leave the publisher. Instead the card travels each line on its own
clock, and the logical phase decides what it looks like when it arrives — solid, ringed, red for a
failed publish, or marked as a redelivery.

A message that arrives without a matching in-flight card — queue backlog, or a redelivery — is still
rendered, entering at the queue node and tagged, so nothing real is dropped from the picture.

## Project layout

```
src/
  App.svelte                     config | stage | config layout; owns the stores
  lib/
    mqttPublisher.svelte.js      MQTT 5 client, QoS 1 publish with user properties
    solaceConsumers.svelte.js    session + N MessageConsumers, queue bind, client ack
    flow.svelte.js               in-flight packet registry and phase machine
    anchors.js                   element registry, so lines and cards use real DOM boxes
    keyColor.js  persist.js  log.svelte.js
  components/
    PublisherNode.svelte         ─┐
    QueueNode.svelte              ├─ static representations on the stage
    ConsumerNode.svelte          ─┘
    FlowLayer.svelte             the lines, and cards walking along them
    PacketCard.svelte            one message
    MqttPanel.svelte             ─┐
    SolacePanel.svelte            ├─ configuration only, no animation anchors
    ConsumerControls.svelte      ─┘
    Field.svelte  StatusDot.svelte  LogPanel.svelte
verify-interop.mjs               headless proof of the interop, no browser needed
```

Svelte 5 (runes) · Tailwind 4 · Vite 8 · mqtt.js 5 · solclientjs 10.

The visualisation and the configuration are deliberately separate components. A consumer appears twice
— as a `ConsumerNode` on the stage and as `ConsumerControls` in the panel — so that sliding a delay or
expanding a message inspector cannot reflow the thing a packet is currently flying towards.

`FlowLayer` measures the node boxes every animation frame and derives both the SVG line geometry and
the card positions from the same cubic-bezier maths, so a card genuinely rides its line. There is no
CSS transition on `transform` — it would fight the per-frame positioning and pull cards off the line.
Recomputing from live rects also means the animation simply follows a window resize, a panel
collapsing, or a consumer being added mid-flight.

Connection settings persist in `localStorage`; **passwords are deliberately not persisted**, since
this app tends to get run against real brokers on a projector.

## Notes

- `⌘/Ctrl + Enter` publishes, so you don't have to hunt for the button mid-demo.
- Connection panels collapse automatically once connected, so the controls you actually use during a
  demo are visible without scrolling.
- The clients are disconnected on `pagehide` / `beforeunload` — see the troubleshooting note above for
  why that matters.
- Pausing a consumer calls `MessageConsumer.stop()`, so the broker sends the backlog to its siblings
  instead of it queueing up locally. Messages already delivered are held unacked and are acknowledged
  on resume.
- Removing a consumer leaves its unacked messages to be redelivered elsewhere; they reappear as cards
  marked `redelivered`.
- The production bundle is ~960 kB (mostly solclientjs). Fine for a demo tool; code-split if you ever
  ship it somewhere latency-sensitive.
