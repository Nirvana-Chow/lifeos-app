import type {PublicEntry} from '../platform/contracts.ts';
import {PlatformError,object} from '../platform/domain.ts';
import type {ObjectFields,OrganizationType} from '../personal-candidate/business.ts';
import {PersonalService,personalEntryType} from '../personal-candidate/service.ts';

export const organizationTypes = ['project','domain','topic'] as const satisfies readonly OrganizationType[];
export type OrganizationEntry = Readonly<{type:OrganizationType;id:string;sourceId:string;revision:number;fields:ObjectFields}>;
export type OrganizationSnapshot = Readonly<{
  scope:'full-current-organization-snapshot';items:readonly OrganizationEntry[];total:number;truncated:false;observedAt:string;
}>;

export function organizationDetail(entry:PublicEntry,spaceId:string):OrganizationEntry {
  const type=personalEntryType(entry,spaceId);
  if(!organizationTypes.includes(type as OrganizationType)||!('text' in entry.draft)||!entry.draft.personal||!('type' in entry.draft.personal))
    throw new PlatformError(404,'NOT_FOUND','没有可访问的组织记录。');
  const {title,text,occurredOn,personal}=entry.draft;
  return {type:type as OrganizationType,id:entry.id,sourceId:entry.source.id,revision:entry.revision,fields:{title,text,occurredOn,personal}};
}

export async function organizationSnapshot(service:PersonalService,ownerId:string):Promise<OrganizationSnapshot> {
  const entries=await service.currentSnapshot(ownerId);
  const items=entries.filter(entry=>organizationTypes.includes(personalEntryType(entry,service.config.spaceId) as OrganizationType))
    .map(entry=>organizationDetail(entry,service.config.spaceId));
  return {scope:'full-current-organization-snapshot',items,total:items.length,truncated:false,observedAt:new Date().toISOString()};
}

export function completeOrganizationFields(value:unknown) {
  const keys=['title','text','occurredOn','personal'];
  const fields=object(value,keys);
  if(keys.some(key=>!Object.hasOwn(fields,key)))throw new PlatformError(400,'COMPLETE_ORGANIZATION_REQUIRED','更新需要完整组织字段。');
  return fields;
}
