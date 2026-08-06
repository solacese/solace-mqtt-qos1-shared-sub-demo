<script>
  import MqttPanel from './components/MqttPanel.svelte'
  import SolacePanel from './components/SolacePanel.svelte'
  import PublisherNode from './components/PublisherNode.svelte'
  import QueueNode from './components/QueueNode.svelte'
  import ConsumerNode from './components/ConsumerNode.svelte'
  import FlowLayer from './components/FlowLayer.svelte'
  import LogPanel from './components/LogPanel.svelte'
  import ComparisonTab from './components/ComparisonTab.svelte'
  import DemoBanner from './components/DemoBanner.svelte'
  import { DemoMode } from './lib/demoMode.svelte.js'
  import { LogStore } from './lib/log.svelte.js'
  import { FlowStore } from './lib/flow.svelte.js'
  import { MqttPublisher } from './lib/mqttPublisher.svelte.js'
  import { SolaceConsumers } from './lib/solaceConsumers.svelte.js'
  import { AnchorRegistry } from './lib/anchors.js'

  const log = new LogStore()
  const flow = new FlowStore()
  const registry = new AnchorRegistry()

  const publisher = new MqttPublisher({ log, flow })
  const consumers = new SolaceConsumers({ log, flow })

  // On by default, so the page opens showing the pattern working rather than two
  // disconnected panels and an empty stage. Clicking Connect on either side tears
  // the simulation down on its own — see DemoMode.
  const demo = new DemoMode({ publisher, consumers, log })
  demo.enable()

  $effect(() => {
    if (!demo.enabled || !demo.streaming) return
    return demo.startStream()
  })

  /** Publishing has to go through demo mode, or the card has nothing to route it. */
  function publishOne() {
    if (demo.enabled) demo.publishOnce()
    else publisher.publish()
  }

  /** The coordinate space for the flow lines and packet cards. */
  let stage = $state(null)

  const TABS = [
    { id: 'demo', label: 'Live demo', blurb: 'real clients, real callbacks' },
    { id: 'why', label: 'Why this pattern', blurb: 'against a pure MQTT broker' },
  ]
  let tab = $state('demo')

  let total = $derived(consumers.totalReceived)
  let consumerIds = $derived(consumers.consumers.map((c) => c.id))

  log.info(
    'mqtt',
    'Ready. Publish with MQTT 5 at QoS 1; consume the same messages with the Solace API from a non-exclusive or partitioned queue.'
  )

  // While the queue is being drained the shortcut is held back for the same reason
  // the button is: the drain consumer would swallow the message.
  let publishBlockedReason = $derived(consumers.draining ? 'Draining the queue…' : null)

  function onKeydown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // The shortcut belongs to the demo. Firing it from the comparison tab
      // would publish to a broker nobody is currently looking at.
      if (tab !== 'demo') return
      e.preventDefault()
      if (publishBlockedReason) {
        log.warn('mqtt', 'The Solace queue is still being drained — nothing published')
        return
      }
      publishOne()
    }
  }

  /**
   * Tear the clients down before the page goes away.
   *
   * Without this, closing or reloading the tab leaves the consumer flows bound on
   * the broker until it times them out. Those orphaned flows keep taking their
   * turn on a non-exclusive queue and never acknowledge anything, so messages are
   * handed to them, sit unacked, and are eventually requeued. The visible symptom
   * is a demo that quietly stops delivering after a few reloads — which is very
   * hard to diagnose from the UI, since everything reports as connected.
   */
  let torndown = false
  function teardown() {
    if (torndown) return
    torndown = true
    try {
      publisher.disconnect()
    } catch {
      /* going away regardless */
    }
    try {
      consumers.disconnect()
    } catch {
      /* going away regardless */
    }
  }
</script>

<svelte:window onkeydown={onKeydown} onpagehide={teardown} onbeforeunload={teardown} />

<main class="flex h-full flex-col gap-3 p-3">
  <header class="flex shrink-0 items-center gap-3 px-1">
    <h1 class="text-sm font-semibold text-slate-200">MQTT → Solace Interop</h1>
    {#if tab === 'demo'}
      <p class="hidden text-[11px] text-slate-500 lg:block">
        Publish with MQTT 5 QoS 1 · consume with the Solace API · load balance over a non-exclusive
        or partitioned queue
      </p>
    {:else}
      <p class="hidden text-[11px] text-slate-500 lg:block">
        Solace partitioned queues against a broker with native MQTT QoS 1 shared subscriptions
      </p>
    {/if}

    <nav class="ml-auto flex shrink-0 gap-1 rounded-md border border-ink-800 bg-ink-950/60 p-1">
      {#each TABS as t (t.id)}
        <button
          onclick={() => (tab = t.id)}
          title={t.blurb}
          class="rounded px-2.5 py-1 text-[11px] font-medium transition {tab === t.id
            ? 'bg-ink-800 text-slate-100'
            : 'text-slate-500 hover:text-slate-300'}"
        >
          {t.label}
        </button>
      {/each}
    </nav>

    {#if tab === 'demo'}
      <p class="hidden shrink-0 text-[10px] text-slate-600 sm:block">⌘/Ctrl + Enter to publish</p>
    {/if}
  </header>

  <!--
    Hidden rather than unmounted while you are on the other tab.

    The clients live in this component so they would survive an unmount, but the
    anchors and the flow layer would not: cards in flight would lose the boxes
    they are travelling between, and coming back would rebuild the stage under a
    live session. Hiding it costs nothing — `AnchorRegistry.box()` already returns
    null for a zero-size element, and FlowLayer holds a card's last position
    rather than snapping it to the origin, so a message that arrives while you are
    reading the comparison is simply waiting where it should be when you return.

    Inline display rather than the `hidden` class, because `hidden` and `flex` are
    both display utilities and which one wins would come down to stylesheet order.
  -->
  <div
    class="flex min-h-0 flex-1 flex-col gap-3"
    style:display={tab === 'demo' ? null : 'none'}
  >
    {#if demo.enabled}
      <DemoBanner {demo} onOpenComparison={() => (tab = 'why')} />
    {/if}

    <!-- Outer grid: configuration on the flanks, visualisation in the middle. The
         flow overlay spans this whole element, so it can draw lines between any of
         the stage's nodes. -->
    <div bind:this={stage} class="relative grid min-h-0 flex-1 grid-cols-[19rem_1fr_21rem] gap-3">
      <MqttPanel {publisher} blockedReason={publishBlockedReason} onPublish={publishOne} />

      <!-- The stage. Everything here is a static representation of a participant;
           none of it is configuration. -->
      <div class="relative grid min-h-0 grid-cols-[8.5rem_1fr_12rem] items-center gap-2">
        <PublisherNode {publisher} {registry} />

        <div class="relative flex h-full min-h-0 flex-col items-center justify-center">
          <QueueNode
            {registry}
            queueName={consumers.config.queueName}
            depth={flow.queuedCount}
            subscription={consumers.config.addSubscription
              ? consumers.config.topicSubscription
              : null}
            subscriptionAdded={consumers.subscriptionAdded}
            bound={consumers.consumers.length > 0}
            draining={consumers.draining}
          />

          <p
            class="absolute bottom-0 max-w-[15rem] text-center text-[10px] leading-relaxed text-slate-500"
          >
            Solace maps <span class="text-slate-300">MQTT QoS 1</span> to Guaranteed delivery. Each
            message is handed to <span class="text-slate-300">one</span> bound consumer — watch
            whether the key colours scatter or stick.
          </p>
        </div>

        <div class="flex h-full min-h-0 flex-col justify-center gap-1.5 overflow-y-auto py-1">
          {#each consumers.consumers as consumer (consumer.id)}
            <ConsumerNode
              {consumer}
              {registry}
              share={total > 0 ? consumer.receivedCount / total : 0}
            />
          {:else}
            <p
              class="rounded-lg border border-dashed border-ink-800 px-2 py-6 text-center text-[10px] leading-snug text-slate-600"
            >
              {#if consumers.connected}
                No consumers bound
              {:else if consumers.draining}
                Draining the queue before binding
              {:else}
                Connect the Solace side to bind consumers
              {/if}
            </p>
          {/each}
        </div>
      </div>

      <SolacePanel {consumers} />

      <FlowLayer {flow} {registry} container={stage} {consumerIds} />
    </div>

    <div class="h-44 shrink-0">
      <LogPanel {log} />
    </div>
  </div>

  <!-- No live connection behind this one, so it is mounted on demand and its
       timers stop the moment you leave it. -->
  {#if tab === 'why'}
    <ComparisonTab onOpenDemo={() => (tab = 'demo')} />
  {/if}
</main>
