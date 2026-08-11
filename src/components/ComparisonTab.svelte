<script>
  import AffinityLab from './AffinityLab.svelte'
  import DimensionCard from './DimensionCard.svelte'
  import { DIMENSIONS, GROUPS, VERDICTS, SOURCES, tally } from '../lib/comparison.js'

  let { onOpenDemo } = $props()

  const counts = tally()
  const order = ['solace', 'mqtt', 'even', 'tradeoff']
  const CHECKED = 'August 2026'

  let byGroup = $derived(
    GROUPS.map((g) => ({ ...g, rows: DIMENSIONS.filter((d) => d.group === g.id) }))
  )

  // Only the pages an actual row cites, so the footer can't drift from the rows.
  let cited = $derived(
    [...new Set(DIMENSIONS.flatMap((d) => d.sources ?? []))].map((id) => ({ id, ...SOURCES[id] }))
  )
</script>

<section class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-ink-800 bg-ink-900/40">
  <div class="mx-auto w-full max-w-[84rem] space-y-4 p-4">
    <!-- The thesis, stated once and up front, so nothing below has to be inferred. -->
    <header class="rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3.5">
      <h2 class="text-sm font-semibold text-slate-100">
        Why a partitioned queue, when other brokers do MQTT shared subscriptions natively?
      </h2>
      <p class="mt-1.5 max-w-4xl text-[11.5px] leading-relaxed text-slate-400">
        Not because of the delivery guarantee. The difference is
        <span class="font-semibold text-slate-200">what the broker is allowed to route on</span>. A
        shared subscription routes on the <span class="text-mqtt">publisher's identity</span> or the
        <span class="text-mqtt">topic string</span>. A partitioned queue routes on
        <span class="text-solace">a property of the message</span>, and hands partitions between
        consumers with a formal, acknowledgement-aware protocol. Reconnect behaviour, rebalancing and
        the ceiling on useful consumers all follow from that.
      </p>
      <p class="mt-2 max-w-4xl text-[11px] leading-relaxed text-slate-500">
        What that buys you: <span class="text-slate-300">scale out without losing per-entity
        ordering</span>, with the routing key as an ordinary message property — so the topic taxonomy
        stays free to model the domain, the publisher needs no changes, and the affinity survives
        publisher reconnects, consumer reconnects and scaling events without a line of application
        state management. The shared-subscription equivalents get part of the way there, and the rows
        below are where each one stops.
      </p>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        {#each order as v (v)}
          {#if counts[v]}
            <span class="rounded-md px-2 py-1 text-[10px] font-semibold ring-1 {VERDICTS[v].chip}">
              {counts[v]} × {VERDICTS[v].label}
            </span>
          {/if}
        {/each}
        <span class="text-[10px] text-slate-600">
          across {DIMENSIONS.length} dimensions · vendor docs checked {CHECKED}
        </span>
        <button
          onclick={onOpenDemo}
          class="ml-auto rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
        >
          See it on a real broker →
        </button>
      </div>
    </header>

    <AffinityLab />

    {#each byGroup as group (group.id)}
      <div class="space-y-1.5">
        <div class="flex items-baseline gap-3 px-1">
          <h3 class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            {group.label}
          </h3>
          <div class="h-px flex-1 bg-ink-800"></div>
        </div>

        <!-- Column headings, once per group, so a wide row never loses its sides. -->
        <div class="hidden gap-x-4 px-4 md:grid md:grid-cols-[13rem_1fr_1fr]">
          <span class="text-[9px] font-semibold tracking-wide text-slate-600 uppercase">
            Dimension · sources
          </span>
          <span
            class="flex items-center gap-1.5 text-[9px] font-semibold tracking-wide text-solace uppercase"
          >
            <span class="h-1.5 w-1.5 rounded-sm bg-solace"></span> Solace partitioned queue
          </span>
          <span
            class="flex items-center gap-1.5 text-[9px] font-semibold tracking-wide text-mqtt uppercase"
          >
            <span class="h-1.5 w-1.5 rounded-sm bg-mqtt"></span> Native MQTT shared subscription
          </span>
        </div>

        {#each group.rows as row (row.id)}
          <DimensionCard {row} />
        {/each}
      </div>
    {/each}

    <!-- Everything cited, in one place, for anyone who wants to check the lot. -->
    <footer class="rounded-xl border border-ink-800 bg-ink-900/50 px-4 py-3">
      <h3 class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Sources</h3>
      <p class="mt-1 text-[10px] leading-relaxed text-slate-500">
        Every claim on this tab is quoted from one of these, or observed in this repo's own run
        against <span class="font-mono">solace-pubsub-standard</span>. Checked {CHECKED} — vendors
        ship, so re-check before reusing this. EMQX and HiveMQ differ from each other on several rows;
        "MQTT" is not one behaviour.
      </p>
      <ul class="mt-1.5 grid gap-x-6 gap-y-1 md:grid-cols-2">
        {#each cited as s (s.id)}
          <li class="text-[10px] leading-snug">
            {#if s.url}
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                class="text-slate-400 underline decoration-ink-700 underline-offset-2 transition hover:text-slate-200"
              >
                {s.label} ↗
              </a>
            {:else}
              <span class="text-slate-500">{s.label}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </footer>
  </div>
</section>
