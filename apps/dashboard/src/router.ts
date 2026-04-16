import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router';
import { useAuthStore } from './stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/admin/login',
    name: 'login',
    component: () => import('./views/LoginView.vue'),
    meta: { public: true },
  },
  { path: '/admin/', redirect: '/admin/overview' },
  { path: '/admin', redirect: '/admin/overview' },
  {
    path: '/admin/overview',
    name: 'overview',
    component: () => import('./views/OverviewView.vue'),
  },
  {
    path: '/admin/claims',
    name: 'claims',
    component: () => import('./views/ClaimsView.vue'),
  },
  {
    path: '/admin/claims/:id',
    name: 'claim-detail',
    component: () => import('./views/ClaimsView.vue'),
    props: true,
  },
  {
    path: '/admin/abuse',
    name: 'abuse',
    component: () => import('./views/AbuseView.vue'),
  },
  {
    path: '/admin/account',
    name: 'account',
    component: () => import('./views/AccountView.vue'),
  },
  {
    path: '/admin/integrators',
    name: 'integrators',
    component: () => import('./views/IntegratorsView.vue'),
  },
  {
    path: '/admin/config',
    name: 'config',
    component: () => import('./views/ConfigView.vue'),
  },
  {
    path: '/admin/logs',
    name: 'logs',
    component: () => import('./views/LogsView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/admin/overview' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to: RouteLocationNormalized) => {
  const auth = useAuthStore();
  const isPublic = to.meta['public'] === true;
  if (isPublic) return true;
  if (!auth.isAuthenticated) {
    return {
      path: '/admin/login',
      query: { next: to.fullPath },
    };
  }
  return true;
});
