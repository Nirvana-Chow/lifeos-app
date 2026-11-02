import type {ProjectLink} from '../records-candidate/contracts.ts';
import {normalizeProjectLinks} from '../records-candidate/domain.ts';
export const projectLinkKey=(link:ProjectLink)=>link.type+':'+link.id;
export function addProjectLink(links:ProjectLink[],selected:ProjectLink):ProjectLink[]{return normalizeProjectLinks([...links,selected]);}
export function removeProjectLink(links:ProjectLink[],selected:ProjectLink):ProjectLink[]{return normalizeProjectLinks(links.filter(link=>projectLinkKey(link)!==projectLinkKey(selected)));}
export function refreshProjectLink(links:ProjectLink[],prior:ProjectLink,current:ProjectLink):ProjectLink[]{
 if(prior.type!==current.type||prior.id!==current.id||prior.sourceId!==current.sourceId)throw Error('关联来源不可用，请重新选择。');
 const index=links.findIndex(link=>projectLinkKey(link)===projectLinkKey(prior));if(index<0||links[index].revision!==prior.revision||links[index].sourceId!==prior.sourceId)throw Error('关联已变化，请重新核对。');
 return normalizeProjectLinks(links.map((link,at)=>at===index?current:link));
}
