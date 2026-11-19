import type { Hono } from 'hono';

import type { AppEnv } from '../app.js';

export default function (router: Hono<AppEnv>) {
  router.on(['GET', 'POST'], '/auth/*', (context) => {
    return context.var.dependencies.auth.handler(context.req.raw);
  });
}
