'use client';
import {useEffect} from 'react';

// WeChat and iOS may resize only the visual viewport when the keyboard opens.
export default function MobileViewport(){
  useEffect(()=>{
    const root=document.documentElement,viewport=window.visualViewport;
    let frame=0;
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      root.style.setProperty('--visible-height',`${viewport?.height??window.innerHeight}px`);
      root.style.setProperty('--visible-top',`${viewport?.offsetTop??0}px`);
    });};
    update();window.addEventListener('resize',update);viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',update);viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);root.style.removeProperty('--visible-height');root.style.removeProperty('--visible-top');};
  },[]);
  return null;
}
