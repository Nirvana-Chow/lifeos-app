export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    id: '/personal',
    name: 'LifeOS',
    short_name: 'LifeOS',
    lang: 'zh-CN',
    start_url: '/personal',
    scope: '/',
    display: 'standalone',
    icons: [
      {src: '/api/platform/install/icon.svg', sizes: 'any', type: 'image/svg+xml'},
      {src: '/api/platform/install/apple-icon.png', sizes: '180x180', type: 'image/png'},
    ],
  }, {
    headers: {'Content-Type': 'application/manifest+json'},
  });
}
