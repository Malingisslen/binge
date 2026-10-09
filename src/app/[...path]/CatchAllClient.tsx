'use client';

import DynamicRouter from '@/components/pages/DynamicRouter';
import { PageNotFound } from '@/components/ui/PageNotFound';

export default function CatchAllClient() {
  return <DynamicRouter fallback={<PageNotFound />} />;
}
