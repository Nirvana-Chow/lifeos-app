'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readCookingAccess, type CookingAccess } from './log-access';
import styles from './workspace.module.css';

export function CookingRecordAction({ recipeId }: {recipeId?: string}) {
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

  if (!access) {
    return !recipeId && access === null ? <span>做饭记录与照片待接入。</span> : null;
  }
  if (recipeId && !access.writable) return null;
  return (
    <Link className={styles.recipeLink} prefetch={false}
      href={recipeId ? '/personal/cooking/history?recipe=' + encodeURIComponent(recipeId) : '/personal/cooking/history'}>
      {recipeId ? '记录这次' : '做饭历史'}
    </Link>
  );
}
