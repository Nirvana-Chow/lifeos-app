import type {SourceEvidence} from '../platform/contracts.ts';
import type {CalendarDraft} from './domain.ts';
export type CalendarEntry=CalendarDraft&{id:string;ownerId:string;status:'planned'|'cancelled';revision:number;source:SourceEvidence;createdAt:string;updatedAt:string};
export type PublicCalendarEntry=Omit<CalendarEntry,'ownerId'>;
export type CalendarResult={entry:PublicCalendarEntry;duplicate:boolean};
export type CalendarHistory={entry:CalendarEntry;raw:unknown};
export type CalendarReceipt={digest:string;result:CalendarResult};
export interface CalendarTransaction {
 get(id:string):Promise<CalendarEntry|null>;
 receipt():Promise<CalendarReceipt|null>;
 saveReceipt(receipt:CalendarReceipt):Promise<void>;
 write(entry:CalendarEntry,raw:unknown,create:boolean):Promise<void>;
}
export interface CalendarRepository {
 list(owner:string):Promise<CalendarEntry[]>;
 get(owner:string,id:string):Promise<CalendarEntry|null>;
 history(owner:string,id:string):Promise<CalendarHistory[]>;
 exportSnapshot(owner:string):Promise<{entries:CalendarEntry[];history:CalendarHistory[]}>;
 transaction<T>(owner:string,key:string,fn:(tx:CalendarTransaction)=>Promise<T>):Promise<T>;
}
