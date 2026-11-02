"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <main><h1>合成环境暂不可用</h1><p>数据库或依赖未就绪，未保存正式数据。</p><button onClick={reset}>重试读取</button></main>;}
