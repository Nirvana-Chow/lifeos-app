'use client';

export default function ErrorPage({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  const reference = /^\d{1,20}$/.test(error.digest ?? '') ? error.digest : null;
  return <main>
    <h1>页面暂不可用</h1>
    <p>请重试读取。如果刚刚保存过，请先核对结果。</p>
    {reference && <p>页面故障编号 {reference}</p>}
    <button type="button" onClick={reset}>重试读取</button>
    <a href="/">返回首页</a>
  </main>;
}
