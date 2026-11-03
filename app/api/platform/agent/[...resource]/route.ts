import {handleAgentRequest} from '../../../../../src/agent-api/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleAgentRequest;
export const POST = handleAgentRequest;
export const PATCH = handleAgentRequest;
