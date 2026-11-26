'use client';

import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {flexRender,useTable,type ColumnDef} from '@tanstack/react-table';
import {DataGrid,DataGridContainer,dataGridFeatures} from '../ui-review/reui/data-grid';
import {
 DataGridTableBase,DataGridTableBody,DataGridTableBodyRow,DataGridTableBodyRowCell,
 DataGridTableHead,DataGridTableHeadRow,DataGridTableHeadRowCell,DataGridTableViewport,
} from '../ui-review/reui/data-grid-table';
import {Button} from '../ui-review/ui/button';
import {projectCareerRequirements,type CareerRecord,type CareerRequirementRow} from './projection';
import s from './career.module.css';

const labels={requirement:'岗位要求',facts:'已关联原事实',gap:'缺口 / 未知',nextAction:'补证或行动'};

function EvidenceFacts({row,onOpenRecord}:{row:CareerRequirementRow;onOpenRecord?:(record:CareerRecord)=>void}) {
 return <>
  {row.facts.length ? <ul>{row.facts.map(fact => <li key={fact.id}>
   {onOpenRecord ? <Button data-slot="personal-record-action" className={s.factAction} type="button" variant="link"
    onClick={()=>onOpenRecord(fact)}>{fact.fields.title}</Button> : fact.fields.title}
   <small>版本 {fact.revision}</small>
  </li>)}</ul> : <p>尚无可核对的关联事实</p>}
  {row.unavailable.length>0 && <p className={s.hint}>{row.unavailable.length} 条事实引用已变更或未读到，暂不作为证据。</p>}
 </>;
}

export function CareerMatch({record,records,onOpenRecord}:{
 record:CareerRecord;records:readonly CareerRecord[];onOpenRecord?:(record:CareerRecord)=>void;
}) {
 const region=useRef<HTMLElement>(null),description=useId();
 const [compact,setCompact]=useState(false);
 const personal=record.fields.personal;
 const rows=useMemo(()=>projectCareerRequirements(personal,records),[personal,records]);
 useEffect(()=>{
  const element=region.current;
  if(!element) return;
  const update=()=>setCompact(element.clientWidth<560);
  update();
  const observer=new ResizeObserver(update);
  observer.observe(element);
  return ()=>observer.disconnect();
 },[]);

 const columns=useMemo<ColumnDef<typeof dataGridFeatures,CareerRequirementRow>[]>(()=>{
  const requirement={id:'requirement',header:labels.requirement,accessorKey:'requirement'} as const;
  if(compact) return [requirement,{id:'details',header:'事实与补证',cell:({row:{original}})=><dl className={s.evidenceDetails}>
   <dt>{labels.facts}</dt><dd><EvidenceFacts row={original} onOpenRecord={onOpenRecord}/></dd>
   <dt>{labels.gap}</dt><dd>{original.gap??'未填写'}</dd>
   <dt>{labels.nextAction}</dt><dd>{original.nextAction??'未填写'}</dd>
  </dl>}];
  return [
   requirement,
   {id:'facts',header:labels.facts,cell:({row})=><EvidenceFacts row={row.original} onOpenRecord={onOpenRecord}/>},
   {id:'gap',header:labels.gap,cell:({row})=>row.original.gap??'未填写'},
   {id:'nextAction',header:labels.nextAction,cell:({row})=>row.original.nextAction??'未填写'},
  ];
 },[compact,onOpenRecord]);
 const table=useTable({features:dataGridFeatures,columns,data:rows,enableRowSelection:false,
  state:{pagination:{pageIndex:0,pageSize:Math.max(rows.length,1)}}});
 const tableClassName=compact?`${s.evidenceTable} ${s.compactEvidence}`:s.evidenceTable;

 return <section ref={region} aria-label="JD 要求与事实证据" aria-describedby={rows.length?description:undefined} className={s.match}>
  <h3>岗位要求与事实证据</h3>
  {rows.length ? <>
   <p id={description} className={s.hint}>本人记录的要求、证据与待补行动；不生成资格判断或匹配分数。</p>
   <DataGridContainer className={s.evidenceGrid}>
    <DataGrid table={table} recordCount={rows.length} tableLayout={{width:'auto',headerBorder:true,headerBackground:true,rowBorder:true}}
     tableClassNames={{base:tableClassName}}>
     <DataGridTableViewport>
      <DataGridTableBase>
       <DataGridTableHead>
        {table.getHeaderGroups().map(group=><DataGridTableHeadRow key={group.id} rowId={group.id}>
         {group.headers.map(header=><DataGridTableHeadRowCell key={header.id} header={header}>
          {flexRender(header.column.columnDef.header,header.getContext())}
         </DataGridTableHeadRowCell>)}
        </DataGridTableHeadRow>)}
       </DataGridTableHead>
       <DataGridTableBody>
        {table.getRowModel().rows.map(row=><DataGridTableBodyRow row={row} key={row.id}>
         {row.getVisibleCells().map(cell=>cell.column.id==='requirement'
          ? <th key={cell.id} scope="row" className={s.evidenceRowHeader}>{row.original.requirement}</th>
          : <DataGridTableBodyRowCell cell={cell} key={cell.id}>
             {flexRender(cell.column.columnDef.cell,cell.getContext())}
            </DataGridTableBodyRowCell>)}
        </DataGridTableBodyRow>)}
       </DataGridTableBody>
      </DataGridTableBase>
     </DataGridTableViewport>
    </DataGrid>
   </DataGridContainer>
  </> : <p className={s.hint}>尚未拆分岗位要求。保留 JD 原文后，可逐条关联原事实与补证行动。</p>}
 </section>;
}
