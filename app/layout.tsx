import type { ReactNode } from 'react';
import {themeInitializationScript} from '../src/workbench/theme';
import {ThemeRuntime} from '../src/workbench/theme-runtime';
import './theme.css';
import './globals.css';
export default function Layout({children}:{children:ReactNode}){return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeInitializationScript}}/></head><body className="lifeos-page-body"><ThemeRuntime/>{children}</body></html>;}
