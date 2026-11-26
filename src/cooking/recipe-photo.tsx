'use client';

import {useEffect,useRef,useState} from 'react';
import recipePhotos from './recipe-photos.json';
import tomatoThumb from './recipe-assets/2130948c0fd24404-thumb.webp';
import tomatoDetail from './recipe-assets/2130948c0fd24404-detail.webp';
import prawnThumb from './recipe-assets/4dbabae176214aaa-thumb.webp';
import prawnDetail from './recipe-assets/4dbabae176214aaa-detail.webp';
import fishThumb from './recipe-assets/547705f2774cf0ed-thumb.webp';
import fishDetail from './recipe-assets/547705f2774cf0ed-detail.webp';
import crayfishThumb from './recipe-assets/e2a148eb6cf115e2-thumb.webp';
import crayfishDetail from './recipe-assets/e2a148eb6cf115e2-detail.webp';
import styles from './workspace.module.css';

const images = {
  '2130948c0fd24404': {thumb:tomatoThumb,detail:tomatoDetail},
  '4dbabae176214aaa': {thumb:prawnThumb,detail:prawnDetail},
  '547705f2774cf0ed': {thumb:fishThumb,detail:fishDetail},
  e2a148eb6cf115e2: {thumb:crayfishThumb,detail:crayfishDetail},
} satisfies Record<keyof typeof recipePhotos,{thumb:typeof tomatoThumb;detail:typeof tomatoDetail}>;

export function RecipePhoto({id, name, detail=false}: {id:string;name:string;detail?:boolean}) {
  if (!Object.hasOwn(images,id)) return <PhotoPlaceholder detail={detail} />;
  const recipeId = id as keyof typeof images;
  const image = images[recipeId][detail?'detail':'thumb'];
  return <RegisteredPhoto key={image.src} recipeId={recipeId} image={image} name={name} detail={detail} />;
}

function PhotoPlaceholder({detail}:{detail:boolean}) {
  return <span className={detail?styles.detailPlaceholder:styles.thumbnailPlaceholder}>暂无成品图</span>;
}

function RegisteredPhoto({recipeId,image,name,detail}:{recipeId:keyof typeof images;image:typeof tomatoThumb;name:string;detail:boolean}) {
  const photo = recipePhotos[recipeId];
  const [failed,setFailed] = useState(false);
  const element = useRef<HTMLImageElement>(null);
  useEffect(()=>{
    if(element.current?.complete && element.current.naturalWidth===0)setFailed(true);
  },[]);

  if(failed)return <PhotoPlaceholder detail={detail} />;
  const picture = <img src={image.src} alt={detail ? `${name}的成品照片` : ''} width={image.width} height={image.height}
    ref={element} onError={()=>setFailed(true)} loading="lazy" decoding="async" className={detail?styles.detailPicture:styles.thumbnail} />;
  return detail ? <figure className={styles.photoFigure}>
    {picture}
    <figcaption className={styles.meta}>
      <a href={photo.source} target="_blank" rel="noreferrer">成品照片 · {photo.credit}</a>{' · '}
      <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a>{' · 已缩放并转为 WebP'}
    </figcaption>
  </figure> : picture;
}
