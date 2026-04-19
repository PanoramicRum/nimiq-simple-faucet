import DefaultTheme from 'vitepress/theme'
import CardGrid from './CardGrid.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CardGrid', CardGrid)
  },
}
