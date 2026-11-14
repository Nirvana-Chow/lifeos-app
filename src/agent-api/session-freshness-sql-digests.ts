/** Exact prosrc SHA256 values from the reviewed, PG-qualified 0024 migration.
 * Legacy readiness remains compatible with its original schema; enabling the
 * new session mode separately requires verifySessionDurationPool's new bodies.
 * These alternatives never relax the caller's owner, ACL or role checks. */
export const sessionFreshnessSqlDigests={
 verify_management_session:'ebdc31bbb67ca43bba5946eb9348c9f532606f7fc8274c9e6c2187b25fd61088',
 set_managed_grant_scopes:'98d6c5dfd667770c6072363599c19f520f2257bc4c213ac3924fc30183c0fb54',
 set_managed_business_grant:'72272b10f49e2966bfdc5857a1263801b88f921cc9bb4012091aa3e2757c9295',
 oauth_business_owner_ready:'bfa6b772a46b71c17b82ef2a8f8d8a031eda4eeb9373232e900d6ae7d64ed2bd',
 set_file_handoff_permission:'42001ce1da25437978bf95abd6f158dd36fd25305099a7c3717214a50cb68c82',
} as const;

export function reviewedSessionBodyDigests(name:string,legacy:string):readonly string[]{
 const fresh=sessionFreshnessSqlDigests[name as keyof typeof sessionFreshnessSqlDigests];
 return fresh?[legacy,fresh]:[legacy];
}
