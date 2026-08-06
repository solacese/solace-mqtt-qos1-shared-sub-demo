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

Colour-coded cards ride those lines. Connect a broker and every phase transition comes from a real
mqtt.js or solclientjs callback — nothing is on a timer pretending to be a broker. Before you connect
one, **demo mode** simulates the transport so the page is not an empty stage, and says so in a banner
rather than letting you mistake it for live traffic.

## Why this demo exists

Solace permits MQTT shared subscriptions only at **QoS 0 on non-durable sessions**. So MQTT alone
cannot give you load-balanced *guaranteed* delivery. Binding several Solace SMF consumers to one
queue does — and the MQTT publisher needs no changes and no knowledge of the consumers.

Add a **partitioned** queue and you also get per-key ordering affinity: every message carrying the
same partition key is handled by the same consumer, so you can scale out without losing per-entity
ordering.

## The two tabs

| Tab | What it is |
|---|---|
| **Live demo** | Real clients against a real broker: every card moves because an mqtt.js or solclientjs callback fired. Until you connect one, demo mode simulates the transport — labelled as such in a banner. |
| **Why this pattern** | The argument against a broker that does MQTT QoS 1 shared subscriptions natively. A model, not a client — and it says so on screen. |

The comparison tab exists because "use a partitioned queue" invites the obvious objection: EMQX and
HiveMQ support shared subscriptions at QoS 1, so what is missing? The answer is not the delivery
guarantee. It is **what the broker is allowed to route on**:

```
MQTT shared subscription   consumer  = f(publisher identity)  or  f(topic string)
Solace partitioned queue   partition = hash(partition key) MOD partitionCount
```

This tab is customer-facing, so it is built to survive someone who knows the other product:

- **Every claim is sourced.** Each row in `src/lib/comparison.js` carries the vendor doc pages it
  came from, and the tab renders them as links per row plus a combined Sources footer. Where a claim
  comes from this repo's own broker run rather than a doc, it says so.
- **The MQTT side is not a straw man.** All five dispatch strategies are selectable and are the real
  documented ones: `round_robin` (EMQX default), `random` (HiveMQ's behaviour), `sticky`,
  `hash_clientid` and `hash_topic`. Pick `hash_topic` and the MQTT side earns the same
  *"every key on exactly one consumer"* verdict Solace does — because with the key in the topic, it
  genuinely gets there. The panel then shows what that costs.
- **Rows where Solace loses or draws are first-class.** End-to-end protocol is an MQTT edge, admin
  overhead is a trade-off, and delivery guarantee and consumer visibility are draws.
- **Verdicts are comparative, not absolute** — which product is better on that dimension. A Solace
  edge can still carry a documented limitation, and where it does the limitation is stated in full:
  the rebalance-ordering row is a Solace edge because Solace bounds the exposure with a handoff
  window and an ack timer where a shared subscription does not bound it at all, and the row still
  quotes Solace's own "a key sequence can therefore split across consumers".
- **Verdicts are stated, not implied.** The scoreboard is computed from the rows, so it cannot drift.
  It currently reads 8 Solace edge · 2 Even · 1 Trade-off · 1 MQTT edge.

Both routing models live in `src/lib/affinitySim.svelte.js` and are driven side by side from one set
of controls, so the two sides can only diverge because the rule diverged. What the panel shows is
derived from the rules, not scripted — including two numbers worth knowing:

| Scaling 3 → 4 consumers | Key mappings that move |
|---|---|
| EMQX `hash_topic` (modulo over subscriber count) | 3 of 4, immediately, no handoff |
| Solace partitioned queue (formal rebalance) | 1 of 4, after the rebalance delay |

Both models can also strand a consumer, and the difference is what you can do about it: on a shared
subscription the ceiling is the number of publishers or distinct topics — application shape — while
on a partitioned queue it is the partition count, which is broker config, though Solace documents
changing it as service-affecting. Scale past either and consumers are labelled **unreachable** with
the reason.

### What validating the claims changed

Worth recording, because most of these were plausible and wrong:

| Claim | What the docs actually say |
|---|---|
| "First-party KEDA scaler merged into KEDA" | `solace-event-queue` is in the official catalog but is **community**-maintained. (The competitive half got *stronger*: KEDA has no MQTT, EMQX, HiveMQ or Mosquitto scaler at all.) |
| "Loses messages on cluster split; declared shared subs required for durability" | Not supported by either vendor's docs. HiveMQ's *declared* shared subscriptions are about enqueueing **when no subscriber is connected**, not split-brain. Row reframed to that. |
| "Consumer receives its assigned partition set in the bind response" | True on the wire, but the API uses it internally for reconnect continuity — the application "has no knowledge of which partition a message was delivered from". Downgraded from a Solace edge to a draw. |
| "No mechanism to route two publishers' messages for the same key to one consumer" | EMQX `hash_topic` does exactly that if the key is in the topic. Now a selectable strategy and its own row. |
| "Keyed on publisher ClientID or session-random" | EMQX-specific. HiveMQ has no keyed option at all — it "distributes the messages randomly". |
| "QoS 1/2 supported" | EMQX yes; HiveMQ downgrades QoS 2 to QoS 1 inside a shared subscription. |
| Partition key is `QUEUE_PARTITION_KEY` | Solace documents MQTT 5 publishers using `JMSXGroupID`. This repo separately verified `QUEUE_PARTITION_KEY` works; the tab states both and which is which. |

Vendor docs were checked in August 2026. Re-check before reusing this in front of anyone — and note
that EMQX and HiveMQ differ from each other on several rows, so "MQTT" is not one behaviour.

## Quick start

```bash
npm install
npm run dev          # then open the printed URL
```

**No broker needed to look around.** The app opens in **demo mode**, which is on by default: three
consumers are bound, a message is published every 1.7s, and the cards flow. An amber banner says so,
next to a prominent link to the comparison tab.

What is simulated is deliberately narrow — the transport and the acknowledgement. Everything the demo
is actually about still runs for real: the key rotation, the topic template, the MQTT 5 user
properties, the flow phase machine, the per-consumer work delay, pausing a consumer holding its
message unacked, and the partition routing rule itself. A simulated delivery joins the *same*
`#accept` path a real broker message takes, so there is one code path rather than a parallel fake one.

The banner switches between the two queue behaviours without a broker, which is the fastest way to see
the contrast this whole demo exists for:

| Mode | Rule | What you see |
|---|---|---|
| `partitioned` | `partition = key-hash MOD 4`, one partition per consumer | Each key sticks to one consumer; the *keys seen* chips stay disjoint |
| `non-exclusive` | Next available consumer takes the message | Keys scatter; every consumer accumulates every key |

Clicking **Connect** on either panel tears the simulation down automatically — `connect()` calls
`exitSimulated()`, and demo mode's `enabled` is derived from those flags rather than tracked
separately, so the two cannot get out of step. "Use a real broker" in the banner does the same thing
explicitly.

To run it against a real broker:

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
  App.svelte                     tab bar; config | stage | config layout; owns the stores
  lib/
    mqttPublisher.svelte.js      MQTT 5 client, QoS 1 publish with user properties
    solaceConsumers.svelte.js    session + N MessageConsumers, queue bind, client ack
    flow.svelte.js               in-flight packet registry and phase machine
    anchors.js                   element registry, so lines and cards use real DOM boxes
    demoMode.svelte.js           broker-free demo mode: routing rule + auto-publish
    affinitySim.svelte.js        ─┐ comparison tab: the two routing rules,
    comparison.js                ─┘ and the twelve dimensions with their verdicts
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
    DemoBanner.svelte            demo-mode notice + the comparison-tab link
    ComparisonTab.svelte         ─┐
    AffinityLab.svelte            ├─ the "Why this pattern" tab
    AffinityPanel.svelte          │  one panel per routing rule
    DimensionCard.svelte         ─┘
    Field.svelte  StatusDot.svelte  LogPanel.svelte
verify-interop.mjs               headless proof of the interop, no browser needed
```

The comparison tab's diagram is positioned from **fixed percentages**, not measured DOM boxes: its
layout is static, so percentages survive a resize for free and it needs no animation frame loop.
That is the opposite trade to `FlowLayer`, whose nodes genuinely move under it. It also means `left`
and `top` are safe to hand to a CSS transition, which is why `.sim-chip` has one and `.packet`
deliberately does not.

Switching to the comparison tab **hides** the demo rather than unmounting it, so a live session and
any cards in flight survive the trip. `AnchorRegistry.box()` already returns null for a zero-size
element and `FlowLayer` holds a card's last position rather than snapping it to the origin, so a
message that arrives while you are reading the comparison is simply waiting where it should be when
you come back. The comparison tab has no connection behind it and is mounted on demand, so its
timers stop the moment you leave it.

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
