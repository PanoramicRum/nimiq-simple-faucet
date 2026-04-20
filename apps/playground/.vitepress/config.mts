import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Nimiq Faucet Playground',
  description: 'Developer playground for the Nimiq Simple Faucet — integrate, deploy, and monitor',
  base: '/nimiq-simple-faucet/',

  appearance: 'dark',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Mulish:wght@400;600;700;800&family=Fira+Code:wght@400;500&display=swap', rel: 'stylesheet' }],
  ],

  themeConfig: {
    logo: '/maneki-neko.svg',
    siteTitle: 'Home',

    nav: [
      { text: 'Paths', link: '/paths/' },
      { text: 'SDKs', link: '/frameworks/' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Abuse Layers', link: '/abuse-layers/' },
      { text: 'Faucet Frontend', link: '/claim-ui' },
      { text: 'Monitoring', link: '/monitoring' },
    ],

    sidebar: {
      '/paths/': [
        {
          text: 'Choose your Path',
          items: [
            { text: 'Quick demo', link: '/paths/quick-demo' },
            { text: 'Docker container trial', link: '/paths/docker-trial' },
            { text: 'Full platform walkthrough', link: '/paths/full-walkthrough' },
            { text: 'Drop into my app', link: '/paths/drop-into-app' },
            { text: 'Deploy to production', link: '/paths/deploy-production' },
            { text: 'Fork & customize', link: '/paths/fork-customize' },
            { text: 'Security review', link: '/paths/security-review' },
            { text: 'Just let me read', link: '/paths/just-read' },
          ],
        },
      ],
      '/frameworks/': [
        {
          text: 'Framework Guide',
          items: [
            { text: 'TypeScript SDK', link: '/frameworks/typescript' },
            { text: 'React SDK', link: '/frameworks/react' },
            { text: 'Vue SDK', link: '/frameworks/vue' },
            { text: 'Python SDK', link: '/frameworks/python' },
            { text: 'Go SDK', link: '/frameworks/go' },
            { text: 'Flutter SDK', link: '/frameworks/flutter' },
            { text: 'Capacitor SDK', link: '/frameworks/capacitor' },
            { text: 'React Native SDK', link: '/frameworks/react-native' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Next.js', link: '/examples/nextjs' },
            { text: 'Vue', link: '/examples/vue' },
            { text: 'Capacitor', link: '/examples/capacitor' },
            { text: 'Flutter', link: '/examples/flutter' },
            { text: 'Go Backend', link: '/examples/go' },
            { text: 'Python Backend', link: '/examples/python' },
          ],
        },
      ],
      '/abuse-layers/': [
        {
          text: 'Abuse Prevention',
          items: [
            { text: 'Overview', link: '/abuse-layers/' },
            { text: 'Blocklist', link: '/abuse-layers/blocklist' },
            { text: 'Rate Limiting', link: '/abuse-layers/rate-limiting' },
            { text: 'Cloudflare Turnstile', link: '/abuse-layers/turnstile' },
            { text: 'hCaptcha', link: '/abuse-layers/hcaptcha' },
            { text: 'Hashcash', link: '/abuse-layers/hashcash' },
            { text: 'GeoIP / ASN', link: '/abuse-layers/geoip' },
            { text: 'Device Fingerprint', link: '/abuse-layers/fingerprint' },
            { text: 'On-Chain Heuristics', link: '/abuse-layers/on-chain' },
            { text: 'AI Anomaly Scoring', link: '/abuse-layers/ai-scoring' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/PanoramicRum/nimiq-simple-faucet' },
    ],

    footer: {
      message: 'Built with ❤️ by <a href="https://github.com/PanoramicRum/nimiq-simple-faucet">Richy</a>.',
      copyright: 'MIT License.',
    },
  },
})
