---
outline: deep
---

# Choose your Path

Welcome to the Nimiq Faucet Playground. Select a path below to explore — from a quick 5-minute demo to full production deployment.

<script setup>
import { data } from '../paths.data'

const items = data.adventures.map(a => ({
  icon: a.icon,
  title: a.title,
  details: a.details,
  time: a.time,
  link: a.link,
}))
</script>

<CardGrid :items="items" open />
