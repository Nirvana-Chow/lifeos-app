import type {Transaction} from '../platform/contracts.ts';
import {PlatformError} from '../platform/domain.ts';

export type AgentWriteGrant = Readonly<{grantId: string; ownerId: string; spaceId: string}>;

/** PostgreSQL holds the grant row lock on the business transaction's connection. */
export async function assertAgentTodoWriteGrant(tx: Transaction, grant: AgentWriteGrant): Promise<void> {
  if (!tx.lockAgentTodoWriteGrant) {
    throw new PlatformError(503, 'AGENT_WRITE_FENCE_UNAVAILABLE', '待办写入授权检查暂不可用。');
  }
  if (!await tx.lockAgentTodoWriteGrant(grant)) {
    throw new PlatformError(403, 'WRITE_GRANT_REVOKED', '待办写入授权已失效。');
  }
}
