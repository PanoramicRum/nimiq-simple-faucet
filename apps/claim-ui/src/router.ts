import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './views/HomePage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/status', component: () => import('./views/StatusPage.vue') },
    { path: '/log', component: () => import('./views/ActivityLog.vue') },
  ],
});
