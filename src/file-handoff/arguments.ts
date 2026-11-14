import {z} from 'zod';import {stageFileSchema,ackFileSchema,fileIdSchema,commandKey} from './contracts.ts';
const key=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
export function fileArgumentSchema(id:string){
 if(id==='stageFileHandoff')return stageFileSchema.extend({idempotencyKey:key});
 if(id==='acknowledgeFileHandoff')return ackFileSchema.extend({idempotencyKey:key});
 return z.strictObject({id:fileIdSchema});
}
export function parseFileArguments(operation:{id:string;path:string;method:string},input:unknown){
 const args=fileArgumentSchema(operation.id).parse(input) as Record<string,unknown>,{id,idempotencyKey,...body}=args;
 return{path:operation.path.replace('{id}',typeof id==='string'?id:''),key:typeof idempotencyKey==='string'?commandKey(idempotencyKey):undefined,body:operation.method==='GET'?undefined:body};
}
