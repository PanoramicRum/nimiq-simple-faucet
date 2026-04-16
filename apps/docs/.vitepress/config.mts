import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Nimiq Simple Faucet',
  description: 'Self-hosted reusable faucet / payout service for Nimiq',
  outDir: '../dist',
  cleanUrls: true,
  ignoreDeadLinks: true,
  sitemap: {
    hostname: 'https://faucet.nimiq.example',
  },
  appearance: true, // dark mode toggleable; light is default
  markdown: {
    lineNumbers: true,
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/quick-start' },
      { text: 'Integrations', link: '/integrations/typescript' },
      { text: 'API', link: '/api/overview' },
      { text: 'MCP', link: '/mcp/overview' },
      { text: 'Security', link: '/security/' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Quick start', link: '/guide/quick-start' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Abuse prevention', link: '/guide/abuse-prevention' },
            { text: 'Host context', link: '/guide/host-context' },
            { text: 'Deployment', link: '/guide/deployment' },
          ],
        },
      ],
      '/integrations/': [
        {
          text: 'Integrations',
          items: [
            { text: 'TypeScript', link: '/integrations/typescript' },
            { text: 'React', link: '/integrations/react' },
            { text: 'Vue', link: '/integrations/vue' },
            { text: 'Capacitor', link: '/integrations/capacitor' },
            { text: 'React Native', link: '/integrations/react-native' },
            { text: 'Flutter', link: '/integrations/flutter' },
            { text: 'Go', link: '/integrations/go' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API reference',
          items: [
            { text: 'Overview', link: '/api/overview' },
            { text: 'Endpoints', link: '/api/endpoints' },
          ],
        },
      ],
      '/mcp/': [
        {
          text: 'MCP',
          items: [
            { text: 'Overview', link: '/mcp/overview' },
            { text: 'Tools', link: '/mcp/tools' },
          ],
        },
      ],
      '/security/': [
        {
          text: 'Security',
          items: [
            { text: 'Overview', link: '/security/' },
            { text: 'Hardening checklist', link: '/security/hardening' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: '#' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright (c) Nimiq contributors',
    },
    search: {
      provider: 'local',
    },
  },
});
