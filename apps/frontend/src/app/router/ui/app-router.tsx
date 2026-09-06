import { RouterProvider } from 'react-router';

import { router } from '../lib/router';

export function AppRouter() {
  return <RouterProvider router={router} />;
}
