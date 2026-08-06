<script>
  // Two stacked full-width bars above the stage. The comparison link leads,
  // because it is the thing we most want a visitor to click; the demo-mode notice
  // sits under it as a caveat about what they are currently looking at.
  let { demo, onOpenComparison } = $props()
</script>

<div class="flex shrink-0 flex-col gap-2">
  <!--
    The comparison tab, as a full-width banner rather than a card in a row.
    `cursor-pointer` is explicit because browsers style <button> as
    `cursor: default`, and this should feel like a link to somewhere else.
  -->
  <button
    onclick={onOpenComparison}
    class="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-solace/45 bg-gradient-to-r from-solace/15 via-solace/8 to-transparent px-4 py-3 text-left shadow-[0_0_36px] shadow-solace/10 transition hover:border-solace/75 hover:from-solace/25 hover:via-solace/12 hover:shadow-solace/20"
  >
    <span
      class="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-solace/20 text-base text-solace ring-1 ring-solace/40 sm:flex"
      aria-hidden="true"
    >
      ⇄
    </span>

    <div class="min-w-0">
      <h2 class="text-sm font-semibold text-solace">
        Why this pattern beats a pure MQTT broker
      </h2>
      <p class="mt-0.5 text-[11px] leading-snug text-slate-400">
        Solace partitioned queues side by side with native MQTT QoS 1 shared subscriptions on EMQX and
        HiveMQ — a live routing simulation plus 12 dimensions, every claim sourced to vendor docs.
      </p>
    </div>

    <span
      class="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-solace/20 px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap text-solace ring-1 ring-solace/50 transition group-hover:bg-solace/30 group-hover:ring-solace/70"
    >
      Compare
      <span class="transition-transform group-hover:translate-x-0.5">→</span>
    </span>
  </button>

  <!-- Demo mode. Amber rather than green: this is a caveat, not a success. -->
  <section
    class="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2"
  >
    <div class="min-w-0">
      <h2 class="flex items-center gap-1.5 text-[12px] font-semibold text-amber-300">
        <span class="h-2 w-2 animate-pulse rounded-full bg-amber-400"></span>
        Demo mode — no broker connected
      </h2>
      <p class="mt-0.5 text-[10px] leading-snug text-slate-400">
        Messages are simulated so the pattern is visible straight away. The routing rule, key
        colouring, work delays and pause behaviour are the real ones — only the transport and the
        acknowledgement are fabricated.
      </p>
    </div>

    <div class="ml-auto flex flex-wrap items-center gap-1.5">
      <!-- The contrast the whole demo teaches, switchable without a broker. -->
      <div class="flex gap-0.5 rounded-md border border-ink-800 bg-ink-950/60 p-0.5">
        {#each [['partitioned', 'partitioned'], ['non-exclusive', 'non-exclusive']] as [id, label] (id)}
          <button
            onclick={() => (demo.queueMode = id)}
            title={id === 'partitioned'
              ? 'partition = key-hash MOD 4 — each key sticks to one consumer'
              : 'Next available consumer takes the message — keys scatter'}
            class="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9px] transition {demo.queueMode ===
            id
              ? 'bg-ink-800 text-slate-100'
              : 'text-slate-500 hover:text-slate-300'}"
          >
            {label}
          </button>
        {/each}
      </div>

      <button
        onclick={() => (demo.streaming = !demo.streaming)}
        class="cursor-pointer rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-[10px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
      >
        {demo.streaming ? 'Pause stream' : 'Resume stream'}
      </button>
      <button
        onclick={() => demo.disable()}
        class="cursor-pointer rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-[10px] font-medium text-slate-400 transition hover:border-slate-600 hover:text-slate-100"
      >
        Use a real broker
      </button>
    </div>
  </section>
</div>
