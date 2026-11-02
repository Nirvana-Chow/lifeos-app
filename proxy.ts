import {NextResponse,type NextRequest} from 'next/server';
import {pageAccess} from './src/platform/page-access';
import {readPlatformPagePrincipal} from './src/platform/runtime';
export async function proxy(request:NextRequest){
 const authForm=request.nextUrl.pathname==='/login'||request.nextUrl.pathname==='/account/password'||request.nextUrl.pathname==='/account/mfa';
 if(authForm&&request.method!=='GET'&&request.method!=='HEAD')return new NextResponse(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'private, no-store'}});
 if(request.nextUrl.pathname.startsWith('/api/'))return NextResponse.json({error:{code:'LEGACY_ROUTE_CLOSED',message:'旧入口已隔离。'}},{status:404,headers:{'Cache-Control':'private, no-store'}});
 const target=authForm?null:await pageAccess(request.nextUrl.pathname,()=>readPlatformPagePrincipal(request.headers));
 const response=target?NextResponse.redirect(new URL(target,request.url)):NextResponse.next();
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Cookie');return response;
}
export const config={matcher:['/login','/account/password','/account/mfa','/review/:path*','/articles/:path*','/candidate/:path*','/api/session','/api/review/:path*']};
