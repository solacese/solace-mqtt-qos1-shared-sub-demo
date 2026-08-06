<script>
  import { VERDICTS, SOURCES } from '../lib/comparison.js'

  let { row } = $props()

  const simLabel = {
    publish: 'watch: publish',
    strategy: 'watch: switch strategy',
    reconnect: 'watch: pub-A reconnects',
    scale: 'watch: ± consumers',
  }

  let verdict = $derived(VERDICTS[row.verdict])
  let sources = $derived((row.sources ?? []).map((id) => ({ id, ...SOURCES[id] })))
</script>

<article class="relative overflow-hidden rounded-lg border border-ink-800 bg-ink-900/50">
  <!-- Colour rail: which way this row goes, readable before any of the prose. -->
  <span class="absolute inset-y-0 left-0 w-0.5 {verdict.rail}"></span>

  <div class="grid gap-x-4 gap-y-2 py-2.5 pr-3.5 pl-4 md:grid-cols-[13rem_1fr_1fr]">
    <div>
      <h4 class="text-[11px] leading-snug font-semibold text-slate-200">{row.dimension}</h4>
      <div class="mt-1 flex flex-wrap items-center gap-1">
        <span class="rounded px-1.5 py-0.5 text-[9px] font-semibold ring-1 {verdict.chip}">
          {verdict.label}
        </span>
        {#if row.sim}
          <span
            class="rounded bg-ink-850 px-1.5 py-0.5 text-[9px] text-slate-400 ring-1 ring-ink-700"
          >
            {simLabel[row.sim]}
          </span>
        {/if}
      </div>

      <!-- Sources, per row. This tab goes in front of customers, so no claim
           should need to be taken on trust. -->
      {#if sources.length}
        <ul class="mt-1.5 space-y-0.5">
          {#each sources as s (s.id)}
            <li class="text-[9px] leading-snug">
              {#if s.url}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  class="text-slate-500 underline decoration-ink-700 underline-offset-2 transition hover:text-slate-300"
                >
                  {s.label} ↗
                </a>
              {:else}
                <span class="text-slate-600">{s.label}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <p class="text-[10.5px] leading-relaxed text-slate-400">
      <span class="font-semibold text-solace md:hidden">Solace · </span>{row.solace}
    </p>

    <p class="text-[10.5px] leading-relaxed text-slate-400">
      <span class="font-semibold text-mqtt md:hidden">Native MQTT · </span>{row.mqtt}
    </p>
  </div>
</article>
