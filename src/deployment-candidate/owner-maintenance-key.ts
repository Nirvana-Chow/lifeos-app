export const ownerMaintenanceProtocol='owner-advisory-v1' as const;
/** Both host maintenance and personal transactions use one owner-specific key. */
export function ownerMaintenanceKey(owner:string):string{if(!/^[A-Za-z0-9_-]{6,80}$/.test(owner))throw Error('OWNER_MAINTENANCE_ID_INVALID');return'lifeos:personal-owner-maintenance:v1:'+owner;}
