import type {Metadata} from 'next';

export const lifeOSInstallMetadata = {
  manifest: '/api/platform/install/manifest.webmanifest',
  icons: {
    icon: '/api/platform/install/icon.svg',
    apple: '/api/platform/install/apple-icon.png',
  },
  appleWebApp: {capable: true, title: 'LifeOS'},
} satisfies Metadata;
