import{candidateBuildDirectory}from'./src/platform/build-directory.ts';
import type { NextConfig } from 'next';
import {resolve} from 'node:path';
const documentHeaders=[
  {key:'Referrer-Policy',value:'same-origin'},
  {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"},
];
const config: NextConfig = {
  distDir:candidateBuildDirectory(),
  output:'standalone', poweredByHeader:false, experimental:{cpus:2},
  turbopack:{root:process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES==='1'?resolve(process.cwd(),'..'):process.cwd()},
  serverExternalPackages:['pg','drizzle-orm'],
  async rewrites() {
    return {beforeFiles:[{
      source:'/personal/storage-review',
      has:[{type:'header',key:'rsc',value:'1'}],
      destination:'/personal/storage-review/workbench',
    }],afterFiles:[],fallback:[]};
  },
  async headers() { return [
    {source:'/:path*',headers:[
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
    ]},
    // Next gives config headers precedence over route-handler headers. Let
    // the standalone HTML supply its own script/style hashes and no-referrer.
    {source:'/:path((?!personal/storage-review$).*)',headers:documentHeaders},
    {source:'/personal/storage-review',has:[{type:'header',key:'rsc',value:'1'}],headers:documentHeaders},
    {source:'/:path((?!_next/static/).*)',headers:[{key:'Cache-Control',value:'private, no-store'}]},
  ]; },
};
export default config;
