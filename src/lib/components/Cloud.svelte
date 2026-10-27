<script lang="ts">
  // The cloud GPU (`perception cloud`): a machine in the user's AWS account, started for a step and deleted after it.
  // On, it shows up as a place in the step menus on Extract; choosing it there is still what sends a step's inputs.
  import Toggle from './ui/Toggle.svelte';
  import type { CloudStatus, PipelineApi } from '../pipeline';

  let { api, cloud, onchange, onbusy }: {
    api: PipelineApi; cloud: CloudStatus;
    /** what is under way, then null (Start run on Extract waits for it) */
    onbusy: (busy: string | null) => void;
    onchange: (now: CloudStatus) => void;
  } = $props();

  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const set = async (on: boolean) => {
    busy = on ? 'Checking AWS…' : 'Turning the cloud GPU off…'; error = null; onbusy(busy);
    try { onchange(await api.cloud(on)); } catch (e) { error = String(e); } finally { busy = null; onbusy(null); attempt++; }
  };
  // the switch is drawn again after each answer: one that failed goes back to what the pipeline says, not what was clicked
  let attempt = $state(0);
</script>

<div class="cloud">
  {#key attempt}
    <Toggle label={`Use ${cloud.machine}, at $${cloud.hourly_usd.toFixed(2)} an hour`} checked={cloud.enabled} disabled={!!busy} onchange={set} />
  {/key}
  <p class="muted">Started in your AWS account (through SkyPilot) for a step, and deleted after it. Each step shows the most it can cost before it runs.</p>
  <div class="status" aria-live="polite">
    {#if busy}<p class="muted">{busy}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>
</div>

<style>
  .cloud { display: grid; gap: 6px; justify-items: start; }
  p { margin: 0; font-size: 12px; max-width: 64ch; }
  .status:empty { display: none; }
</style>
