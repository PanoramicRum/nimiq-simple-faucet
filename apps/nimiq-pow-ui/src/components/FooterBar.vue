<template>
  <footer class="footer">
    <div class="left">
      Built with love by
      <a
        href="https://github.com/PanoramicRum/nimiq-simple-faucet"
        target="_blank"
        rel="noopener"
      >Richy</a>.
    </div>
    <nav class="right">
      <a href="https://github.com/PanoramicRum/nimiq-simple-faucet" target="_blank" rel="noopener">GitHub</a>
      <a href="https://github.com/nimiq/web-miner" target="_blank" rel="noopener" title="Visual tribute to the original">web-miner ↗</a>
    </nav>
  </footer>
</template>

<style scoped>
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1.25rem 2rem;
  font-size: 0.78rem;
  color: rgba(158, 163, 199, 0.7);
  border-top: 1px solid var(--line);
}

.right {
  display: flex;
  gap: 1.5rem;
}
</style>
