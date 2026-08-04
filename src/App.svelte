<script>
  import MqttPanel from './components/MqttPanel.svelte'
  import SolacePanel from './components/SolacePanel.svelte'
  import PublisherNode from './components/PublisherNode.svelte'
  import QueueNode from './components/QueueNode.svelte'
  import ConsumerNode from './components/ConsumerNode.svelte'
  import FlowLayer from './components/FlowLayer.svelte'
  import LogPanel from './components/LogPanel.svelte'
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

  /** The coordinate space for the flow lines and packet cards. */
  let stage = $state(null)

  let total = $derived(consumers.totalReceived)
  let consumerIds = $derived(consumers.consumers.map((c) => c.id))

  log.info(
    'mqtt',
    'Ready. Publish with MQTT 5 at QoS 1; consume the same messages with the Solace API from a non-exclusive or partitioned queue.'
  )

  function onKeydown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      publisher.publish()
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
  <header class="flex shrink-0 items-baseline gap-3 px-1">
    <h1 class="text-sm font-semibold text-slate-200">MQTT → Solace Interop</h1>
    <p class="text-[11px] text-slate-500">
      Publish with MQTT 5 QoS 1 · consume with the Solace API · load balance over a non-exclusive or
      partitioned queue
    </p>
    <p class="ml-auto hidden text-[10px] text-slate-600 sm:block">⌘/Ctrl + Enter to publish</p>
  </header>

  <!-- Outer grid: configuration on the flanks, visualisation in the middle. The
       flow overlay spans this whole element, so it can draw lines between any of
       the stage's nodes. -->
  <div bind:this={stage} class="relative grid min-h-0 flex-1 grid-cols-[19rem_1fr_21rem] gap-3">
    <MqttPanel {publisher} />

    <!-- The stage. Everything here is a static representation of a participant;
         none of it is configuration. -->
    <div class="relative grid min-h-0 grid-cols-[8.5rem_1fr_12rem] items-center gap-2">
      <PublisherNode {publisher} {registry} />

      <div class="relative flex h-full min-h-0 flex-col items-center justify-center">
        <QueueNode
          {registry}
          queueName={consumers.config.queueName}
          depth={flow.queuedCount}
          subscription={consumers.config.addSubscription ? consumers.config.topicSubscription : null}
          subscriptionAdded={consumers.subscriptionAdded}
          bound={consumers.consumers.length > 0}
        />

        <p class="absolute bottom-0 max-w-[15rem] text-center text-[10px] leading-relaxed text-slate-500">
          Solace maps <span class="text-slate-300">MQTT QoS 1</span> to Guaranteed delivery. Each
          message is handed to <span class="text-slate-300">one</span> bound consumer — watch whether
          the key colours scatter or stick.
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
            {consumers.connected ? 'No consumers bound' : 'Connect the Solace side to bind consumers'}
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
</main>
