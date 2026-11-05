'use client';
import type {PublicEntry} from '../platform/contracts';
import {RelationFields} from '../personal-candidate/relation-fields';
import type {PersonPersonal} from './model';

export function PersonFields({value,onChange,disabled=false,options}:{value:PersonPersonal;onChange:(value:PersonPersonal)=>void;disabled?:boolean;options:Record<string,PublicEntry[]>}) {
  return <fieldset disabled={disabled}>
    <legend>人物资料（可留空）</legend>
    <label>别名（每行一个）<textarea name="personAliases" rows={2} maxLength={4820} value={value.aliases.join('\n')} onChange={e=>onChange({...value,aliases:e.target.value.split('\n')})}/></label>
    <label>电话<input name="personPhone" type="tel" maxLength={80} value={value.phone??''} onChange={e=>onChange({...value,phone:e.target.value||null})}/></label>
    <label>邮箱<input name="personEmail" type="email" maxLength={254} value={value.email??''} onChange={e=>onChange({...value,email:e.target.value||null})}/></label>
    <label>公司 / 组织<input name="personCompany" maxLength={240} value={value.company??''} onChange={e=>onChange({...value,company:e.target.value||null})}/></label>
    <label>关系<input name="personRelationship" maxLength={240} value={value.relationship??''} onChange={e=>onChange({...value,relationship:e.target.value||null})}/></label>
    <p>生日只填一种；不知道可留空。目前支持公历。</p>
    <label>生日（完整日期）<input name="personBirthdayOn" type="date" value={value.birthdayOn??''} onChange={e=>onChange({...value,birthdayOn:e.target.value||null,birthdayMonthDay:null})}/></label>
    <label>生日（仅月日，年份未知）<input name="personBirthdayMonthDay" placeholder="MM-DD" pattern="[0-9]{2}-[0-9]{2}" maxLength={5} value={value.birthdayMonthDay??''} onChange={e=>onChange({...value,birthdayOn:null,birthdayMonthDay:e.target.value||null})}/></label>
    <RelationFields value={value.links} options={options} onChange={links=>onChange({...value,links})}/>
  </fieldset>;
}
