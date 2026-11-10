import type {ReactNode} from 'react';
import Link from 'next/link';
import {ArrowLeft} from 'lucide-react';
import {PersonalPage} from '../personal-candidate/personal-page';
import styles from './workspace.module.css';

export function CookingFrame({title,children}:{title:string;children:ReactNode}){
 return <PersonalPage title={title} initialPage="overview" wide>
  <Link href="/personal" className={styles.backLink}><ArrowLeft aria-hidden="true" size={17}/>返回工作台</Link>
  {children}
 </PersonalPage>;
}
