'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="empty-page"><h1>暂时无法打开页面</h1><p>请检查连接后重试，已保存的数据不会丢失。</p><button className="button primary" onClick={reset}>重新加载</button></main>;}
