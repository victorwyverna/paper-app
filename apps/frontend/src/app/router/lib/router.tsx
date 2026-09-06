import { createBrowserRouter } from 'react-router';

import { RootLayout } from '@/app/layouts/root-layout';
import { ArticleCreatePage } from '@/pages/article-create';
import { ArticleEditPage } from '@/pages/article-edit';
import { ArticleViewPage } from '@/pages/article-view';
import { NotFoundPage } from '@/pages/not-found';

import { RouterError } from '../ui/router-error';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    ErrorBoundary: RouterError,
    children: [
      {
        index: true,
        Component: ArticleCreatePage,
      },
      {
        path: ':slug/edit',
        Component: ArticleEditPage,
      },
      {
        path: ':slug',
        Component: ArticleViewPage,
      },
      {
        path: '*',
        Component: NotFoundPage,
      },
    ],
  },
]);
