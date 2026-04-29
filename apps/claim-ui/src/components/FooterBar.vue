<template>
  <footer class="py-12 bg-[#FAF9F7] border-t border-outline-variant/10 mt-auto">
    <div class="flex flex-col md:flex-row justify-between items-center px-12 w-full max-w-7xl mx-auto gap-8">
      <div class="text-sm font-medium text-[#1F2348]/70 font-body leading-relaxed text-center md:text-left">
        Built with love by <a class="hover:text-primary-container underline transition-colors" href="https://github.com/PanoramicRum/nimiq-simple-faucet" target="_blank" rel="noopener">Richy</a>.
      </div>
      <nav class="flex items-center gap-6">
        <a class="text-[#1F2348]/70 text-sm font-medium font-body hover:text-primary-container transition-colors" href="https://github.com/PanoramicRum/nimiq-simple-faucet" target="_blank" rel="noopener">Developer Playground</a>
        <a class="text-[#1F2348]/70 text-sm font-medium font-body hover:text-primary-container transition-colors" href="https://github.com/PanoramicRum/nimiq-simple-faucet" target="_blank" rel="noopener">GitHub</a>
        <RouterLink class="text-[#1F2348]/70 text-sm font-medium font-body hover:text-primary-container transition-colors" to="/status">Status</RouterLink>
      </nav>
    </div>
  </footer>
</template>
