<script>
  import AffinityPanel from './AffinityPanel.svelte'
  import { DispatchSim, KEYS, PUBLISHERS, STRATEGIES } from '../lib/affinitySim.svelte.js'

  // Both models are driven from the same controls, in the same order, with the
  // same keys. If the two sides diverge it is because the routing rule diverged,
  // which is the only claim this panel makes.
  const shared = new DispatchSim('shared-sub')
  const solace = new DispatchSim('partition')
  const sims = [shared, solace]

  let running = $state(true)
  const PUBLISH_EVERY_MS = 820

  let k = 0
  let p = 0
  function publishOnce() {
    // Both publishers send every key: the ordinary case of two services writing
    // updates for the same entity, and the case a shared subscription has no
    // rule for unless the key has been put in the topic.
    const key = KEYS[k++ % KEYS.length]
    const pub = PUBLISHERS[p++ % PUBLISHERS.length]
    for (const sim of sims) sim.publish(key, pub)
  }

  $effect(() => {
    if (!running) return
    const id = setInterval(publishOnce, PUBLISH_EVERY_MS)
    return () => clearInterval(id)
  })

  // The tab is unmounted when you switch away — nothing here holds a broker
  // connection, so there is no reason to keep timers alive in the background.
  $effect(() => () => sims.forEach((s) => s.dispose()))

  let consumerCount = $derived(solace.consumers.length)

  const accents = {
    mqtt: {
      dot: 'bg-mqtt',
      text: 'text-mqtt',
      node: 'border-mqtt/50 bg-mqtt/8',
      consumer: 'border-mqtt/40 bg-mqtt/8',
      flash: 'border-mqtt bg-mqtt/25',
    },
    solace: {
      dot: 'bg-solace',
      text: 'text-solace',
      node: 'border-solace/50 bg-solace/8',
      consumer: 'border-solace/40 bg-solace/8',
      flash: 'border-solace bg-solace/25',
    },
  }
</script>

<section class="rounded-xl border border-ink-800 bg-ink-950/40 p-3">
  <header class="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
    <div>
      <h2 class="text-[12px] font-semibold text-slate-100">
        The same two publishers, the same four keys, two routing rules
      </h2>
      <p class="text-[10px] text-slate-500">
        <span class="text-slate-400">pub-A</span> and
        <span class="text-slate-400">pub-B</span> both publish every key — two services writing
        updates for the same entity. Change the strategy on the left; every option is a real setting.
      </p>
    </div>

    <div class="ml-auto flex flex-wrap items-center gap-1.5">
      <button
        onclick={() => (running = !running)}
        class="rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition {running
          ? 'border border-ink-700 bg-ink-850 text-slate-300 hover:border-slate-600 hover:text-slate-100'
          : 'bg-solace/15 text-solace ring-1 ring-solace/40 hover:bg-solace/25'}"
      >
        {running ? 'Pause' : 'Play'}
      </button>
      <button
        onclick={publishOnce}
        class="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
      >
        Publish one
      </button>

      <span class="mx-0.5 h-5 w-px bg-ink-800"></span>

      <!-- Each of these maps to a row in the table below. -->
      <button
        onclick={() => sims.forEach((s) => s.reconnect('pub-A'))}
        title="Drop pub-A's session and reconnect it with a freshly generated Client ID"
        class="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
      >
        pub-A reconnects
      </button>
      <div class="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1">
        <span class="text-[10px] text-slate-500">consumers</span>
        <button
          onclick={() => sims.forEach((s) => s.removeConsumer())}
          disabled={consumerCount <= 1}
          class="h-5 w-5 rounded text-slate-400 transition hover:bg-ink-800 hover:text-slate-100 disabled:opacity-40"
          aria-label="Remove a consumer from both sides"
        >
          −
        </button>
        <span class="w-4 text-center font-mono text-[11px] text-slate-200">{consumerCount}</span>
        <button
          onclick={() => sims.forEach((s) => s.addConsumer())}
          disabled={consumerCount >= 6}
          class="h-5 w-5 rounded text-slate-400 transition hover:bg-ink-800 hover:text-slate-100 disabled:opacity-40"
          aria-label="Add a consumer to both sides"
        >
          +
        </button>
      </div>
      <button
        onclick={() => sims.forEach((s) => s.reset())}
        class="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11px] font-medium text-slate-400 transition hover:border-slate-600 hover:text-slate-100"
      >
        Reset counts
      </button>
    </div>
  </header>

  <div class="grid gap-3 xl:grid-cols-2">
    <AffinityPanel
      sim={shared}
      accent={accents.mqtt}
      title="Native MQTT QoS 1 shared subscription"
      subtitle="$share/order-workers/orders/# · EMQX mqtt.shared_subscription_strategy"
    >
      {#snippet children()}
        <!-- Every option here is a documented EMQX strategy, named as EMQX names
             it. hash_topic is included precisely because it is the strongest
             counter-argument — leaving it out would make this a straw man. -->
        <div class="mt-1.5 flex flex-wrap gap-1 rounded-md border border-ink-800 bg-ink-950/60 p-1">
          {#each Object.entries(STRATEGIES) as [id, s] (id)}
            <button
              onclick={() => shared.setStrategy(id)}
              title="{s.vendor} · per-key affinity: {s.affinity}"
              class="rounded px-1.5 py-0.5 font-mono text-[9px] transition {shared.strategy === id
                ? 'bg-ink-800 text-slate-100'
                : 'text-slate-500 hover:text-slate-300'}"
            >
              {s.label}
            </button>
          {/each}
        </div>
      {/snippet}
    </AffinityPanel>

    <AffinityPanel
      sim={solace}
      accent={accents.solace}
      title="Solace partitioned queue"
      subtitle="q/orders-partitioned · 4 partitions · MQTT in, SMF/JMS out"
      ruleNote="The publisher's identity plays no part in the decision, and the key is a property of the message rather than part of the topic. Each partition is owned by exactly one bound consumer flow."
    >
      {#snippet children()}
        <!-- Occupies the same height as the strategy picker opposite, so the two
             diagrams line up — and says something true while doing it. -->
        <div
          class="mt-1.5 rounded-md border border-ink-800 bg-ink-950/60 p-1 text-center font-mono text-[9px] text-slate-600"
        >
          one routing rule · nothing to choose
        </div>
      {/snippet}
    </AffinityPanel>
  </div>

  <div class="mt-2 space-y-1 px-1">
    <p class="text-[10px] leading-snug text-slate-600">
      <span class="text-slate-500">This panel is a model, not a client.</span> It runs no broker
      connection. The routing rules are transcriptions of documented behaviour, and everything you see
      — splits, unreachable consumers, held messages, rebalances — is derived from them rather than
      scripted. The <span class="text-slate-400">Live demo</span> tab is the opposite: every card
      there moves because a real mqtt.js or solclientjs callback fired.
    </p>
    <p class="text-[10px] leading-snug text-slate-600">
      <span class="text-slate-500">On the partition key:</span> Solace documents MQTT 5 publishers
      setting <span class="font-mono">JMSXGroupID</span> as a user property (AMQP uses
      <span class="font-mono">group-id</span>). This repo separately verified
      <span class="font-mono">QUEUE_PARTITION_KEY</span> arriving from an MQTT 5 publisher and
      driving partition assignment on <span class="font-mono">solace-pubsub-standard</span> — see
      <span class="font-mono">verify-interop.mjs</span>. MQTT 3.1.1 publishers cannot set a key at all
      and get a random partition.
    </p>
  </div>
</section>
