'use client';

import {Button} from './ui/button';
import {useSupportOwner} from './requirement-support-hooks';
import styles from './owner-release-notice.module.css';

/** Keep interrupted requests recoverable without opening an update announcement. */
export function OwnerReleaseNotice({scope}:{scope:string}){
 const {owner,session,mutation}=useSupportOwner();
 const bound=owner&&JSON.stringify([owner.ownerId,owner.spaceId])===scope&&owner.writable&&owner.requirementsEnabled&&owner.requirementSupportEnabled;
 if(!bound||mutation.phase!=='uncertain')return null;
 return <section role="status" className={styles.recovery}>
  <p>上次保存尚未完成，可以继续。</p>
  <Button disabled={!mutation.pending} onClick={()=>void session?.retry()}>继续上次保存</Button>
  <a href="/personal/requirements/updates">查看更新记录</a>
 </section>;
}
