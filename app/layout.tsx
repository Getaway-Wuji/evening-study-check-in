import type { Metadata,Viewport } from 'next';
import './globals.css';
import './clay.css';
import MobileViewport from '@/components/mobile-viewport';
export const metadata:Metadata={title:'晚习 · 班级晚自习',description:'班级晚自习打卡、定位核验与请假管理，支持独立部署。',robots:{index:false,follow:false},applicationName:'晚习'};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',interactiveWidget:'resizes-content',themeColor:'#edf2f8'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body><MobileViewport/><script dangerouslySetInnerHTML={{__html:"window.__studyEntryURL=location.href.split('#')[0];"}}/>{children}</body></html>;}
