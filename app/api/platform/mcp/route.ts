import {handleMcpHttpRequest} from '../../../../src/mcp-http/runtime';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=handleMcpHttpRequest;
export const POST=handleMcpHttpRequest;
export const DELETE=handleMcpHttpRequest;
export const OPTIONS=handleMcpHttpRequest;
