import{candidateBuildDirectory}from'./src/platform/build-directory.ts';
import type { NextConfig } from 'next';
import {resolve} from 'node:path';
const config: NextConfig = {
  distDir:candidateBuildDirectory(),
  output:'standalone', poweredByHeader:false, experimental:{cpus:2},
  turbopack:{root:process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES==='1'?resolve(process.cwd(),'..'):process.cwd()},
  serverExternalPackages:['pg','drizzle-orm'],
  async headers() { return [{source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'same-origin'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"},
  ]},{source:'/:path((?!_next/static/).*)',headers:[{key:'Cache-Control',value:'private, no-store'}]}]; },
};
export default config;
