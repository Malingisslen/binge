import CatchAllClient from './CatchAllClient';

export function generateStaticParams() {
  return [{ path: ['_'] }];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function CatchAllPage(props: { params: { path: string[] } }) {
  return <CatchAllClient />;
}
