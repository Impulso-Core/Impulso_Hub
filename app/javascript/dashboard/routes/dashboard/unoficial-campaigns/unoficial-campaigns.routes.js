import { frontendURL } from 'dashboard/helper/URLHelper.js';

const meta = {
  permissions: ['administrator', 'agent'],
};

const unoficialCampaignsRoutes = {
  routes: [
    {
      path: frontendURL('accounts/:accountId/unoficial-campaigns'),
      name: 'unoficial_campaigns',
      component: () => import('./pages/Index.vue'),
      meta: {
        ...meta,
      },
    },
  ],
};

export default unoficialCampaignsRoutes;
