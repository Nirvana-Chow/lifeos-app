import type {PublicEntry} from '../../src/platform/contracts.ts';
export function journalFixture(number:number,date:string|null,text='Synthetic original diary'):PublicEntry {
 const id='10000000-0000-4000-8000-'+String(number).padStart(12,'0');
 const fields={title:'Synthetic diary '+number,text,occurredOn:date};
 return {id,kind:'inbox',draft:{...fields,disposition:'reference'},revision:1,createdAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z',syncState:'draft',externalStatus:null,source:{id:'20000000-0000-4000-8000-'+String(number).padStart(12,'0'),system:'website',externalId:id,version:1,asOf:'2026-11-12T00:00:00.000Z',original:{marker:'personal-manual-v1',spaceId:'synthetic-journal-space',type:'journal',input:{spaceId:'synthetic-journal-space',confirmed:true,fields}}}};
}
export const journalStatus={ownerId:'synthetic-journal-owner',spaceId:'synthetic-journal-space',storageVerified:true,allowedTypes:['journal']};
