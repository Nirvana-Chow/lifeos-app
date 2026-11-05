/** Match the owner shell's exact native h1 text in its server-rendered HTML. */
export function hasOwnerShellHeading(html:string,heading:string):boolean{
 return [...html.matchAll(/<h1(?:\s[^<>]*)?>([^<>]*)<\/h1>/g)].some(match=>match[1]===heading);
}
