import type{ReactNode}from'react';import{WorkbenchShell}from'../../../src/workbench/shell';
import {headers} from 'next/headers';import {redirect} from 'next/navigation';import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
export default async function Layout({children}:{children:ReactNode}){let owner=null;try{owner=await readPlatformPagePrincipal(await headers());}catch{}if(!owner)redirect('/login');return <WorkbenchShell>{children}</WorkbenchShell>;}
