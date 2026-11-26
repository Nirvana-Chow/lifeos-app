import {diaryPackageFormat,type DiarySource} from '../../src/import-preview/historical-diary.ts';

export const scope={ownerId:'synthetic-owner',spaceId:'synthetic-diary'};
export const batch=(...entries:DiarySource[])=>({format:diaryPackageFormat,sourceNamespace:'fixture-only',entries});
export const source=(id:string,version='v1'):DiarySource=>({
  originalId:id,sourcePath:'synthetic/'+id+'.md',sourceVersion:version,date:'2004-02-29',
  body:'  # Synthetic '+id+'\r\n\r\n仅为合成样本。\n',
});
