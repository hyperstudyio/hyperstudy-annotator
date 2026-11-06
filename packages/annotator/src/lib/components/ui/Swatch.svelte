<script lang="ts">
  let { colour, size = 10 }: { colour: string; size?: number } = $props();
</script>

<span class="swatch" style="background:{colour}; width:{size}px; height:{size}px" aria-hidden="true"></span>

<style>
  .swatch { border-radius: 3px; flex: none; display: inline-block; }
</style>
