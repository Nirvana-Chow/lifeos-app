'use client';

export default function PersonalError({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  const reference = /^\d{1,20}$/.test(error.digest ?? '') ? error.digest : null;
  return <main data-lifeos-surface="personal">
    <h1>本人工作台暂不可用</h1>
    <p>如果刚刚提交保存，请重新读取后核对结果。</p>
    {reference && <p>页面故障编号 {reference}</p>}
    <button type="button" onClick={reset}>重试读取</button>
  </main>;
}
