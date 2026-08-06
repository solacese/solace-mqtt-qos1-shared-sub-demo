<script>
  import { keyCss } from '../lib/keyColor.js'
  import { KEYS, PUBLISHERS, PARTITION_COUNT, STRATEGIES, HOP_MS, topicOf } from '../lib/affinitySim.svelte.js'

  let { sim, title, subtitle, ruleNote, accent, children } = $props()

  // Geometry is fixed percentages rather than measured DOM boxes. The live demo
  // has to measure, because its nodes move — panels collapse, consumers come and
  // go mid-flight. Here the layout is mine and it is static, so percentages
  // survive a resize for free and there is no animation frame loop to run.
  const PUB_X = 11
  const BROKER_X = 45
  const CONSUMER_X = 84

  const pubY = (i) => 30 + i * 40
  const consumerY = (i) => 14 + (i + 0.5) * (72 / Math.max(1, sim.consumers.length))

  /**
   * A message resting at the broker sits *below* the node, not on it — the same
   * reason the live demo parks its queued cards under the queue node rather than
   * over the top of its labels.
   */
  const BROKER_REST_DY = 38
  const SPOOL_STEP = 15

  const partitions = Array.from({ length: PARTITION_COUNT }, (_, i) => i)

  // The stage has to grow with the consumer count, or the nodes start overlapping
  // once you scale up — which would break the very thing this is illustrating.
  let stageHeight = $derived(`calc(7rem + ${sim.consumers.length} * 2.9rem)`)

  let consumerIndex = $derived(new Map(sim.consumers.map((c, i) => [c.id, i])))
  let strategy = $derived(sim.model === 'partition' ? null : STRATEGIES[sim.strategy])

  /** Where a chip should be for its current stage, plus a pixel nudge. */
  function chipPos(msg) {
    if (msg.stage === 'atPub') {
      return { x: PUB_X, y: pubY(PUBLISHERS.indexOf(msg.pub)), dy: 0 }
    }
    if (msg.stage === 'toConsumer' || msg.stage === 'landed') {
      const i = consumerIndex.get(msg.target)
      if (i !== undefined) return { x: CONSUMER_X - 13, y: consumerY(i), dy: 0 }
    }
    // toBroker, atBroker, spooled — and anything whose consumer just vanished.
    // Spooled messages fan downwards so a backlog is countable, not a single
    // chip with several hidden underneath it.
    const slot = sim.messages.filter((m) => m.stage === 'spooled').indexOf(msg)
    return { x: BROKER_X, y: 50, dy: BROKER_REST_DY + Math.max(0, slot) * SPOOL_STEP }
  }

  // A line is lit while a message is actually on it — the same idea as the live
  // demo's `.flow-edge-active`, and the same CSS.
  let activePubs = $derived(
    new Set(sim.messages.filter((m) => m.stage === 'toBroker').map((m) => m.pub))
  )
  let activeConsumers = $derived(
    new Set(sim.messages.filter((m) => m.stage === 'toConsumer').map((m) => m.target))
  )

  let splitKeys = $derived(new Set(sim.splitKeys))
  let idle = $derived(new Set(sim.idleConsumers))
  let spooledCount = $derived(sim.messages.filter((m) => m.stage === 'spooled').length)

  // Node labels come from the sim, so each routing rule has exactly one
  // implementation and the diagram cannot disagree with the dispatch.
</script>

<section class="flex min-h-0 flex-col rounded-xl border border-ink-800 bg-ink-900/60">
  <header class="border-b border-ink-800 px-3.5 py-2.5">
    <h3 class="flex items-center gap-2 text-[12px] font-semibold text-slate-100">
      <span class="h-2.5 w-2.5 rounded-sm {accent.dot}"></span>
      {title}
    </h3>
    <p class="mt-0.5 text-[10px] text-slate-500">{subtitle}</p>

    <!-- Strategy picker, or the partitioned queue's fixed rule. -->
    {@render children?.()}

    <p class="mt-1.5 rounded bg-ink-950/60 px-2 py-1 font-mono text-[10px] {accent.text}">
      {sim.rule}
    </p>
    <p class="mt-1 min-h-[2.4rem] text-[10px] leading-snug text-slate-500">
      {strategy ? strategy.note : ruleNote}
    </p>
  </header>

  <!-- The stage. Two publishers on the left, the broker in the middle, the
       bound consumers on the right. -->
  <div class="relative shrink-0 overflow-hidden transition-[height]" style:height={stageHeight}>
    <svg class="absolute inset-0 h-full w-full" aria-hidden="true">
      {#each PUBLISHERS as pub, i (pub)}
        <line
          x1="{PUB_X}%"
          y1="{pubY(i)}%"
          x2="{BROKER_X}%"
          y2="50%"
          class="flow-edge"
          class:flow-edge-active={activePubs.has(pub)}
        />
      {/each}
      {#each sim.consumers as c, i (c.id)}
        <line
          x1="{BROKER_X}%"
          y1="50%"
          x2="{CONSUMER_X}%"
          y2="{consumerY(i)}%"
          class="flow-edge"
          class:flow-edge-active={activeConsumers.has(c.id)}
        />
      {/each}
    </svg>

    {#each PUBLISHERS as pub, i (pub)}
      <div
        class="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-mqtt/40 bg-mqtt/8 px-2 py-1 text-center"
        style:left="{PUB_X}%"
        style:top="{pubY(i)}%"
      >
        <span class="block font-mono text-[10px] text-mqtt">{pub}</span>
        <!-- Not `uppercase`: it renders "QoS" as "QOS", which reads as a typo. -->
        <span class="block text-[8px] tracking-wide text-slate-500">MQTT 5 · QoS 1</span>
        {#if sim.model !== 'partition'}
          <!-- The Client ID matters here: it is an input to hash_clientid, and it
               changes on reconnect the way a generated one really does. -->
          <span class="block font-mono text-[8px] text-slate-600">{sim.clientId(pub)}</span>
        {/if}
      </div>
    {/each}

    <div
      class="absolute z-10 flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-lg border-2 {accent.node} px-2 py-1.5"
      style:left="{BROKER_X}%"
      style:top="50%"
    >
      <span class="text-[9px] tracking-wide {accent.text} uppercase">
        {sim.model === 'partition' ? 'partitions' : 'dispatch'}
      </span>
      {#if sim.model === 'partition'}
        <div class="mt-1 flex gap-0.5">
          {#each partitions as p (p)}
            {@const owned = sim.owner[p]}
            <span
              class="flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] {owned
                ? 'bg-solace/20 text-solace'
                : 'bg-ink-850 text-slate-600'}"
              title={owned ? `partition ${p} → ${owned}` : `partition ${p} unassigned`}
            >
              {p}
            </span>
          {/each}
        </div>
      {:else}
        <span class="mt-0.5 font-mono text-[8px] text-slate-300">{sim.strategy}</span>
      {/if}

      {#if sim.rebalancing}
        <span
          class="absolute -top-4 animate-pulse rounded-full bg-ink-900 px-1.5 py-0.5 text-[8px] whitespace-nowrap text-amber-300 ring-1 ring-amber-500/40"
        >
          rebalancing · delivery paused
        </span>
      {:else if spooledCount > 0}
        <span
          class="absolute -top-4 rounded-full bg-ink-900 px-1.5 py-0.5 text-[8px] whitespace-nowrap text-slate-400 ring-1 ring-ink-700"
        >
          {spooledCount} held in queue
        </span>
      {/if}
    </div>

    {#each sim.consumers as c, i (c.id)}
      <div
        class="absolute z-10 w-[5.5rem] -translate-y-1/2 rounded-md border px-1.5 py-1 transition-colors {c.flash
          ? accent.flash
          : idle.has(c.id)
            ? 'border-dashed border-ink-700 bg-ink-900/60'
            : accent.consumer}"
        style:left="{CONSUMER_X}%"
        style:top="{consumerY(i)}%"
      >
        <div class="flex items-baseline justify-between gap-1">
          <span class="font-mono text-[9px] text-slate-300">{c.id}</span>
          <span class="font-mono text-[10px] font-semibold {accent.text}">{c.count}</span>
        </div>
        <span class="block truncate font-mono text-[8px] text-slate-500">
          {sim.bindingFor(c.id)}
        </span>
        {#if idle.has(c.id)}
          <span class="block text-[8px] text-amber-400/80">unreachable</span>
        {/if}
      </div>
    {/each}

    <!-- Messages. Position is set from the stage and CSS moves them there, so a
         chip genuinely travels the line it is drawn on. -->
    {#each sim.messages as msg (msg.id)}
      {@const p = chipPos(msg)}
      {@const c = keyCss(msg.key)}
      <!-- The travel time is handed to CSS from HOP_MS rather than duplicated in
           the stylesheet: if they drifted apart, chips would arrive before or
           after the stage that is supposed to be moving them. -->
      <div
        class="sim-chip z-20 {msg.stage === 'landed' ? 'sim-chip-landed' : ''}"
        style:--hop="{HOP_MS}ms"
        style:left="{p.x}%"
        style:top="calc({p.y}% + {p.dy}px)"
        style:color={c.fg}
        style:background={c.bg}
        style:border="1px solid {c.border}"
      >
        {msg.key}{#if msg.redelivered}<span class="text-slate-400"> ↻</span>{/if}
      </div>
    {/each}
  </div>

  <!-- The punchline. Not a delivery tally — a statement about the routing rule:
       for each key, how many consumers can be handling it at the same time. -->
  <div class="border-t border-ink-800 px-3.5 py-2.5">
    <div class="flex items-baseline justify-between gap-2">
      <h4 class="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
        Who can handle each key
      </h4>
      <!--
        The badge states what the *rule* guarantees, not what the current draw
        happens to show. sticky's initial pick is random, so two publishers can
        land on one consumer and no key splits — that is luck, not a guarantee,
        and a customer-facing panel must not present it as one.
      -->
      {#if sim.affinity === 'key'}
        <span
          class="rounded bg-solace/15 px-1.5 py-0.5 text-[9px] text-solace ring-1 ring-solace/40"
        >
          ✓ every key on exactly one consumer
        </span>
      {:else if sim.affinity === 'publisher'}
        <span
          class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300 ring-1 ring-amber-500/40"
        >
          ⚠ consistent per publisher, not per key · {splitKeys.size} of {KEYS.length} split right now
        </span>
      {:else}
        <span
          class="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] text-rose-300 ring-1 ring-rose-500/40"
        >
          ✗ no per-key affinity — any consumer, any message
        </span>
      {/if}
    </div>

    <div class="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
      {#each sim.ownership as row (row.key)}
        {@const c = keyCss(row.key)}
        <div class="flex items-center gap-1.5">
          <span
            class="shrink-0 rounded px-1 py-px font-mono text-[9px]"
            style:color={c.fg}
            style:background={c.bg}
            style:border="1px solid {c.border}"
          >
            {row.key}
          </span>
          {#if sim.model === 'partition'}
            <span class="font-mono text-[9px] text-slate-600" title="partition = hash(key) MOD 4">
              p{row.partition}
            </span>
          {/if}
          <span class="text-[9px] text-slate-600">→</span>
          {#if row.owners.length === 0}
            <span class="font-mono text-[9px] text-amber-400/80">held</span>
          {:else}
            <span
              class="truncate font-mono text-[9px] {row.owners.length > 1
                ? 'text-rose-300'
                : 'text-slate-300'}"
            >
              {row.owners.join(', ')}
            </span>
          {/if}
        </div>
      {/each}
    </div>

    {#if sim.model !== 'partition' && sim.strategy === 'hash_topic'}
      <p class="mt-1.5 font-mono text-[9px] text-slate-600">
        hashing {topicOf('order-1')} — the key had to be promoted into the topic
      </p>
    {/if}

    <!--
      Both models can strand a consumer, for different reasons, and the
      difference is what you can do about it. On a shared subscription the
      ceiling is the number of publishers or distinct topics — application
      shape. On a partitioned queue it is the partition count, which is broker
      config, though not free to change.
    -->
    {#if idle.size > 0}
      <p class="mt-2 text-[10px] leading-snug text-amber-400/80">
        {#if sim.model === 'partition'}
          {[...idle].join(', ')} own no partitions: a partitioned queue cannot use more consumers
          than partitions. Raising <span class="font-mono">partition count</span> fixes it, but
          Solace documents partition scaling as service-affecting — drain the queue first.
        {:else if sim.strategy === 'hash_topic'}
          {[...idle].join(', ')} are unreachable: with <span class="font-mono">hash_topic</span> the
          ceiling is the number of distinct topics, so scaling past it needs a change to the topic
          taxonomy.
        {:else}
          {[...idle].join(', ')} are unreachable: the key is not part of the decision, so the number
          of consumers that do any work is capped by the number of publishers, not by how many you
          bind.
        {/if}
      </p>
    {/if}

    {#if sim.flash}
      <p
        class="mt-2 rounded-md border px-2 py-1 text-[10px] leading-snug {sim.flash.tone === 'good'
          ? 'border-solace/30 bg-solace/10 text-solace'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}"
      >
        {sim.flash.text}
      </p>
    {/if}
  </div>
</section>
