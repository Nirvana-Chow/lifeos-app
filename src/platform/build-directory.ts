/** Keep an existing fixed UI build intact while validating the next candidate.
 * Never accept arbitrary paths from environment configuration. */
export function candidateBuildDirectory(env:Record<string,string|undefined>=process.env):'.next'|'.next-r516'|'.next-r517'{
 const value=env.LIFEOS_CANDIDATE_DIST_DIR;if(value===undefined||value==='.next')return'.next';
 if(value==='.next-r516'||value==='.next-r517')return value;throw Error('Unsupported candidate build directory');
}
