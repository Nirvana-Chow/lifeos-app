export function tamperSessionToken(header:string):string{
 const pairs=header.split(';').map(pair=>pair.trim()),index=pairs.findIndex(pair=>pair.startsWith('lifeos-platform-candidate.session_token='));
 if(index<0)throw Error('Synthetic session-token cookie is missing');
 pairs[index]+='.tampered';return pairs.join('; ');
}
