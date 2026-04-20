---
layout: home

hero:
  name: Nimiq Simple Faucet
  text: Developer Playground
  tagline: "Integrate, deploy, and monitor the Nimiq Faucet.\nFrom a 5-minute demo to production."
  actions:
    - theme: brand
      text: Quick demo →
      link: /paths/quick-demo
    - theme: alt
      text: View SDKs
      link: /frameworks/
---

<script setup>
import { data as pathsData } from './paths.data'
import { data as sdksData } from './sdks.data'
import { data as examplesData } from './examples.data'
import { data as abuseData } from './abuseLayers.data'

const pathItems = pathsData.adventures.map(a => ({
  icon: a.icon,
  title: a.title,
  details: a.details,
  time: a.time,
  link: a.link,
}))

const sdkItems = sdksData.sdks.map(s => ({
  icon: s.icon,
  title: s.name,
  details: s.package,
  badge: s.install,
  link: s.link,
}))

const exampleItems = examplesData.examples.map(e => ({
  icon: e.icon,
  title: e.name,
  details: e.details,
  link: e.link,
}))

const abuseItems = abuseData.layers.map(l => ({
  icon: l.icon,
  title: l.name,
  details: l.details,
  badge: l.enabledBy,
  link: l.link,
}))
</script>

<CardGrid title="Getting Started" :items="pathItems" open />

<CardGrid title="Abuse Prevention" :items="abuseItems" open />

<CardGrid title="Frameworks & SDKs" :items="sdkItems" />

<CardGrid title="Examples" :items="exampleItems" />

<CardGrid title="More" :items="[
  { icon: '📊', title: 'Monitoring', details: 'Health checks, observability & alerting', link: '/monitoring' },
  { icon: '📈', title: 'Analytics', details: 'Live faucet statistics', link: '/analytics' },
]" />
