import type {WindowMode,WindowPosition,WindowRow} from './window-contracts.ts';
import type {TodoDraft,FinanceDraft,InboxDraft} from './domain.ts';
export type Kind='todo'|'finance'|'inbox';
export type Principal={userId:string;email:string};
export type SourceEvidence={id:string;system:'website';externalId:string;version:number;asOf:string;original:unknown};
export type StoredEntry={id:string;ownerId:string;kind:Kind;inboxId?:string;draft:TodoDraft|FinanceDraft|InboxDraft;source:SourceEvidence;revision:number;createdAt:string;updatedAt:string;syncState:'draft';externalStatus:null};
export type PublicEntry=Omit<StoredEntry,'ownerId'>;
export type MutationResult={entry:PublicEntry;duplicate:boolean};
export type Receipt={digest:string;result:MutationResult};
export interface Transaction {
 /** Agent-only capability, held until this same transaction ends. */
 lockAgentTodoWriteGrant?(grant: Readonly<{grantId:string;ownerId:string;spaceId:string}>):Promise<boolean>;
 /** Nonlocking discovery on this transaction's connection. Decisions must use
  * a subsequent locked get and revision check, not this preliminary value. */
 peek(kind:Kind,id:string):Promise<StoredEntry|null>;
 /** Lock the row until commit. Refund creation and edits of its source must serialize. */
 get(kind:Kind,id:string):Promise<StoredEntry|null>;
 /** Called while the source row is locked; return current linked refunds in this transaction. */
 refundsFor(id:string):Promise<StoredEntry[]>;
 derivedTodo(inboxId:string):Promise<StoredEntry|null>;
 receipt():Promise<Receipt|null>;
 saveReceipt(value:Receipt):Promise<void>;
 write(entry:StoredEntry,raw:unknown,create:boolean):Promise<void>;
}
export interface PlatformRepository {
 /** Consistent current records only; at most 10001 so callers reject overflow. */
 readCurrentSnapshot?(owner:string):Promise<StoredEntry[]>;
 readWindow?(owner:string,mode:WindowMode,position:WindowPosition,limit:number):Promise<WindowRow[]>;
 list(owner:string,kind:Kind):Promise<StoredEntry[]>;
 history(owner:string,kind:Kind,id:string):Promise<StoredEntry[]>;
 exportSnapshot(owner:string):Promise<{entries:StoredEntry[];history:StoredEntry[]}>;
 get(owner:string,kind:Kind,id:string):Promise<StoredEntry|null>;
 transaction<T>(owner:string,key:string,fn:(tx:Transaction)=>Promise<T>):Promise<T>;
}
export interface SessionReader {read(headers:Headers):Promise<Principal|null>}
