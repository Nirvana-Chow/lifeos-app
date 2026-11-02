'use client';
import Link from'next/link';import {PersonalHomeOverview} from '../personal-candidate/home-overview';
import{Card,CardHeader,CardTitle,CardContent}from'../../components/ui/card';
import{Icon}from'../admin-preview/icons';
import{RecentRecords}from'./recent-records';
import{useWorkspaceStatus}from'./status';
import{workbenchNavigation}from'./navigation';
import s from'./styles.module.css';
export function WorkbenchHome(){
 const status=useWorkspaceStatus(),quick=['todos','finance','health','journal','growth','articles'];
 return <div className={s.page}>
  <div className={s.pageHeader}><h1>总览</h1><Link className={s.buttonSecondary} href="/review/admin/settings">个人设置</Link></div>
  {status.state==='unavailable'&&<p className={s.error} role="alert">个人空间尚未连接，暂时无法读取记录。</p>}
  <div className={s.homeGrid}><div className={s.stack}>
   <Card className={`${s.panel} ${s.captureCard}`}><CardContent className={s.panelBody}>
    <div className={s.captureIcon}><Icon name="file" size={24}/></div><h2>今天想记录什么？</h2><p className={s.composeCopy}>记下想法、安排，或今天发生的事。</p>
    <div className={s.actions}><Link className={s.button} href="/review/admin/journal">写日记<Icon name="arrow" size={18}/></Link><Link className={s.buttonSecondary} href="/personal?page=tasks&create=todo">新建待办</Link><Link className={s.buttonSecondary} href="/review/admin/chat">AI 聊天</Link></div>
   </CardContent></Card>
   <section><div className={s.sectionHeader}><h2>生活与积累</h2></div><div className={s.quickGrid}>{quick.map(id=>{const m=workbenchNavigation.find(x=>x.id===id)!;return <Link className={s.quickLink} href={m.href} key={id}><span className={s.quickIcon}><Icon name={m.icon} size={20}/></span><span>{m.title}</span><Icon name="chevron" size={16}/></Link>;})}</div></section>
   <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>最近记录</h2></CardTitle><Link href="/review/admin/records">查看全部</Link></CardHeader>{status.state==='personal'?<CardContent className={s.panelBody}><PersonalHomeOverview/></CardContent>:<RecentRecords allowed={status.state==='review-only'&&status.storageConnected} checking={status.state==='checking'} loginRequired={status.state==='not-signed-in'} onRefresh={()=>void status.refresh()}/>}</Card>
  </div><aside className={s.stack}>
   <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>你的空间</h2></CardTitle></CardHeader><CardContent className={s.panelBody}><div className={s.summaryList}><Link className={s.summaryRow} href="/review/admin/settings"><span>账号与隐私</span><Icon name="chevron" size={16}/></Link><Link className={s.summaryRow} href="/review/admin/settings/ai"><span>AI 服务设置</span><Icon name="chevron" size={16}/></Link><Link className={s.summaryRow} href="/review/admin/settings/data"><span>数据与来源</span><Icon name="chevron" size={16}/></Link></div></CardContent></Card>
   <Card className={s.panel}><CardHeader className={s.panelHead}><CardTitle><h2>AI 工作台</h2></CardTitle></CardHeader><CardContent className={s.panelBody}><div className={s.summaryList}>{[['本人空间','personal'],['AI 辅助录入','capture'],['资料与检索','knowledge'],['RAG 知识库','rag'],['Agent 与固定流程','workflows'],['执行与待审批','approvals']].map(([name,id])=><Link className={s.summaryRow} key={id} href={'/review/admin/'+id}><span>{name}</span><Icon name="chevron" size={16}/></Link>)}</div></CardContent></Card>
  </aside></div>
 </div>;
}
