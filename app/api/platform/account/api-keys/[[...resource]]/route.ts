import {handleKeyManagementRequest} from '../../../../../../src/agent-api/key-web';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleKeyManagementRequest;
export const POST = handleKeyManagementRequest;
export const DELETE = handleKeyManagementRequest;
