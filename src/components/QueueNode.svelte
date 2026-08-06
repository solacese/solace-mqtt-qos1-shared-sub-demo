<script>
  import { anchor } from '../lib/anchors.js'

  let { queueName, depth, subscription, subscriptionAdded, bound, draining, registry } = $props()
</script>

<!-- Static representation of the broker's queue: the hub every flow line meets at. -->
<div class="flex flex-col items-center gap-2">
  <p class="text-[9px] font-semibold tracking-widest text-broker/80 uppercase">
    Solace PubSub+ Broker
  </p>

  <div
    use:anchor={{ registry, name: 'queue' }}
    class="relative flex h-24 w-44 flex-col items-center justify-center rounded-xl border-2 border-broker/50 bg-broker/8 shadow-[0_0_40px] shadow-broker/10"
  >
    <span class="max-w-[10rem] truncate px-2 font-mono text-[11px] text-broker">{queueName}</span>
    <span class="mt-0.5 font-mono text-2xl font-semibold text-slate-100">{depth}</span>
    <!-- Deliberately not called "queue depth": this counts only the messages this
         UI is currently tracking. The broker's real spool may hold a backlog we
         never published and cannot see without the management API. -->
    <span
      class="text-[9px] tracking-wide text-slate-500 uppercase"
      title="Messages this UI has published or seen that are waiting for a consumer. Not the broker's total queue depth."
    >
      awaiting consumer
    </span>

    {#if draining}
      <span
        class="absolute -bottom-2 animate-pulse rounded-full bg-ink-900 px-2 py-0.5 text-[9px] whitespace-nowrap text-amber-300 ring-1 ring-amber-500/40"
      >
        draining backlog…
      </span>
    {:else if !bound}
      <span
        class="absolute -bottom-2 rounded-full bg-ink-900 px-2 py-0.5 text-[9px] whitespace-nowrap text-slate-500 ring-1 ring-ink-700"
      >
        not bound
      </span>
    {/if}
  </div>

  {#if subscription}
    <p class="max-w-[11rem] text-center font-mono text-[10px] break-all text-slate-500">
      {#if subscriptionAdded}<span class="text-emerald-400/80">✓</span>{/if}
      {subscription}
    </p>
  {/if}
</div>
