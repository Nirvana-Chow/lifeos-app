export type ChatState='pending'|'completed'|'failed'|'cancelled';
export type ChatMode='synthetic-sdk-test'|'approved-live';
export type ChatProvenance={provider:'volcengine-ark';model:string;configurationRevision:number;materialRevision:number;mode:ChatMode;dataScope:'current-message-only';sources:'not-connected'};
export type ChatTurn={id:string;ownerId:string;userText:string;assistantText:string;state:ChatState;revision:number;createdAt:string;updatedAt:string;provenance:ChatProvenance;errorCode:string|null};
export type PublicChatTurn=Omit<ChatTurn,'ownerId'>;
export type ChatTransition={state:Exclude<ChatState,'pending'>;assistantText:string;errorCode:string|null;updatedAt:string};
export interface ChatRepository{
 reserve(owner:string,proposed:ChatTurn,digest:string):Promise<{created:boolean;turn:ChatTurn}>;
 get(owner:string,id:string):Promise<ChatTurn|null>;
 list(owner:string,limit:number):Promise<ChatTurn[]>;
 page?(owner:string,window:ChatPageWindow,limit:number):Promise<ChatTurn[]>;
 /** Only pending may transition. Return an existing terminal row unchanged. */
 transition(owner:string,id:string,expectedRevision:number,change:ChatTransition):Promise<ChatTurn>;
}
export type ChatSendInput={turnId:string;userText:string;syntheticOnly:true;confirmSend:true};
export type ChatCancelInput={expectedRevision:number;syntheticOnly:true};
export type ChatCapability={available:boolean;mode:ChatMode|'unconfigured';provider:'volcengine-ark';model:string|null;configurationRevision:number|null;reason:'ready'|'not-configured'|'disabled'|'unavailable'};
export type ChatStatus=ChatCapability&{storageReady:boolean;streaming:true;persistsTurns:true;dataScope:'current-message-only';sources:'not-connected';notice:string};
export type ChatHistory={items:PublicChatTurn[];limit:number;truncated:boolean;syntheticIncluded:boolean};
export type ChatStreamEvent=
 |{type:'start';turnId:string;sequence:number;turn:PublicChatTurn;replayed:boolean}
 |{type:'delta';turnId:string;sequence:number;text:string}
 |{type:'done';turnId:string;sequence:number;turn:PublicChatTurn;replayed:boolean}
 |{type:'error';turnId:string;sequence:number;code:string;message:string;turn:PublicChatTurn|null};
/** Server-only selected capability. Neither secret nor hidden history is input. */
export interface ChatProvider{
 readonly provenance:ChatProvenance;
 stream(userText:string,signal:AbortSignal):AsyncIterable<string>;
 assertCurrent(signal:AbortSignal):Promise<void>;
}
export interface ChatProviderSelector{
 chatStatus(owner:string):Promise<ChatCapability>;
 chatProvider(owner:string):Promise<ChatProvider|undefined>;
}

/** Bounded, current-owner persisted-chat snapshot; not a complete-system backup. */
export type ChatExport={
 format:'lifeos.chat.export.v1';scope:'current-owner-isolated-review';exportedAt:string;
 selection:{limit:50;returnedTurns:number;truncated:boolean;order:'createdAt-desc-id-desc';snapshot:'single-owner-list-read'};
 syntheticIncluded:true;serverCredentialsIncluded:false;backupOrRestoreVerified:false;
 contentSemantics:{userText:'original-user-input';assistantText:'generated-not-verified-facts'};
 items:PublicChatTurn[];
};

export type ChatPoint={createdAt:string;id:string};
export type ChatPageWindow={anchor:ChatPoint|null;after:ChatPoint|null};
export type ChatPageExport=Omit<ChatExport,'format'|'selection'>&{
 format:'lifeos.chat.export-page.v1';
 selection:Omit<ChatExport['selection'],'snapshot'>&{snapshot:'per-page-read-committed'};
 page:{cursorUsed:string|null;nextCursor:string|null;hasMore:boolean;snapshotConsistent:false;backdatedInsertionsMayBeMissed:true;revisionsMayChange:true;newerRowsRequireRestart:true};
};
