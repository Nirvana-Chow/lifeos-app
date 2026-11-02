export type CaptureRunProvenance={provider:'volcengine-ark';model:string;configurationRevision:number;materialRevision:number;mode:'synthetic-sdk-test'|'approved-live'};
export type CaptureRunState='pending'|'ready'|'failed'|'cancelled'|'configuration-changed'|'confirmation-pending'|'confirmed';
export type CaptureRunRecord={kind:'todo'|'inbox';id:string;sourceId:string;revision:1};
/** Private metadata only. Digests are not anonymization and must stay owner-scoped. */
export type CaptureRun={id:string;ownerId:string;revision:number;state:CaptureRunState;kind:'todo'|'life';adapter:'manual'|'synthetic-fixture'|'ai';sourceHash:string;provenance:CaptureRunProvenance|null;createdAt:string;updatedAt:string;confirmationHash:string|null;record:CaptureRunRecord|null};
export type CaptureRunEvidence=Pick<CaptureRun,'id'|'sourceHash'|'provenance'>;
export type PublicCaptureRun=Omit<CaptureRun,'ownerId'|'sourceHash'|'confirmationHash'>;
export interface CaptureRunRepository{
 get(owner:string,id:string):Promise<CaptureRun|null>;
 change(owner:string,id:string,fn:(previous:CaptureRun|null)=>CaptureRun):Promise<CaptureRun>;
}
