'use client';
import {useEffect} from 'react';
import {themeStore} from './theme-store';
/** Mounted once in the root, including auth and standalone editor routes. */
export function ThemeRuntime(){useEffect(()=>themeStore.start(),[]);return null;}
