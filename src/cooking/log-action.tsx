'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readCookingAccess, type CookingAccess } from './log-access';
import { Button } from '../ui-review/ui/button';
import styles from './workspace.module.css';

export function CookingRecordAction({ recipeId, entry=false }: {recipeId?: string;entry?:boolean}) {
  const [access, setAccess] = useState<CookingAccess | null | undefined>(undefined);
  useEffect(() => {
    let controller: AbortController | undefined;
    function check() {
      controller?.abort();
      setAccess(undefined);
      if (document.visibilityState === 'hidden') return;
      const request = new AbortController();
      controller = request;
      void readCookingAccess(fetch, request.signal).then(
        result => { if (!request.signal.aborted) setAccess(result); },
        () => { if (!request.signal.aborted) setAccess(null); },
      );
    }
    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      controller?.abort();
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if(entry){
    return <>
      {access?.writable ? <Button asChild><Link href="/personal/cooking/history?new=1" prefetch={false}>记录做过的菜</Link></Button>
        : <Button type="button" disabled>记录做过的菜</Button>}
      {access && <Link className={styles.recipeLink} href="/personal/cooking/history" prefetch={false}>做饭历史</Link>}
      {access===null && <span className={styles.meta}>做饭记录暂不可用</span>}
      {access?.writable===false && <span className={styles.meta}>当前只读</span>}
    </>;
  }
  if (!access?.writable || !recipeId) return null;
  return (
    <Link className={styles.recipeLink} prefetch={false}
      href={'/personal/cooking/history?recipe=' + encodeURIComponent(recipeId)}>
      记录这次
    </Link>
  );
}
