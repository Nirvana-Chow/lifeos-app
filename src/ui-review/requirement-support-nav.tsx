import Link from 'next/link';
import styles from './requirement-support.module.css';
const tabs=[['pool','需求池','/personal?page=requirements'],['roadmap','阶段路线图','/personal/requirements/roadmap'],['updates','更新记录','/personal/requirements/updates'],['feedback','反馈 Inbox','/personal/requirements/feedback']] as const;
export function RequirementSupportNav({current}:{current:'roadmap'|'updates'|'feedback'}){return <nav className={styles.nav} aria-label="需求与反馈">{tabs.map(([id,title,href])=><Link key={id} href={href} aria-current={current===id?'page':undefined}>{title}</Link>)}</nav>;}
