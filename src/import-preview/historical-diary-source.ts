export type DiarySource = Readonly<{originalId:string;sourcePath:string;sourceVersion:string;date:string;body:string}>;
export const diarySourceToken = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const diaryJournalTextLimit=16384;
const malformedUnicode=/[\uD800-\uDFFF]/u;

function object(value:unknown,fields:readonly string[]):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).length!==fields.length || fields.some(field=>!Object.hasOwn(value,field))) {
    throw new Error('DIARY_INVALID_FIELDS');
  }
  return value as Record<string,unknown>;
}

function match(value:unknown,pattern:RegExp):string {
  if (typeof value!=='string' || !pattern.test(value)) throw new Error('DIARY_INVALID_FIELDS');
  return value;
}

export function readDiarySource(input:unknown):DiarySource {
  const row=object(input,['originalId','sourcePath','sourceVersion','date','body']);
  const originalId=match(row.originalId,diarySourceToken),sourceVersion=match(row.sourceVersion,diarySourceToken);
  const sourcePath=match(row.sourcePath,/^[^\\\x00-\x1f\x7f]{1,400}\.md$/i);
  if (malformedUnicode.test(sourcePath) || sourcePath.includes(':') || sourcePath.split('/').some(part=>part===''||part==='.'||part==='..'||part.startsWith('.'))) {
    throw new Error('DIARY_INVALID_SOURCE_PATH');
  }
  const date=match(row.date,/^[1-9]\d{3}-\d{2}-\d{2}$/);
  const instant=new Date(date+'T00:00:00.000Z');
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0,10)!==date) throw new Error('DIARY_INVALID_DATE');
  const body=row.body;
  if (typeof body!=='string' || malformedUnicode.test(body) || !body.trim() || body.includes('\0') || new TextEncoder().encode(body).byteLength>32_768) {
    throw new Error('DIARY_INVALID_BODY');
  }
  return {originalId,sourcePath,sourceVersion,date,body};
}


/** Browser-safe immutable provenance for the ordinary read-side journal model.
 * The synthetic qualification writer is deliberately outside app composition. */
export function historicalDiaryFields(source:DiarySource) {
  // A generated label, not an assertion about an absent historical title.
  return {title:'历史日记 · '+source.originalId,text:source.body,occurredOn:source.date};
}

export function readHistoricalDiaryEvidence(input:unknown,fields:unknown) {
  const value=object(input,['namespace','source','sourceDigest']);
  const namespace=match(value.namespace,diarySourceToken);
  const source=readDiarySource(value.source),sourceDigest=match(value.sourceDigest,/^[a-f0-9]{64}$/);
  const actual=object(fields,['title','text','occurredOn']);
  const expected=historicalDiaryFields(source);
  if(source.body.length>diaryJournalTextLimit||actual.title!==expected.title||actual.text!==expected.text||
     actual.occurredOn!==expected.occurredOn)throw Error('DIARY_JOURNAL_FIELDS_MISMATCH');
  return {namespace,source,sourceDigest};
}
