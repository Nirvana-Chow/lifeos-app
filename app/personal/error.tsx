'use client';

export default function PersonalError({reset}: {reset: () => void}) {
  return <main data-lifeos-surface="personal">
    <h1>本人工作台暂不可用</h1>
    <p>如果刚刚提交保存，请重新读取后核对结果。</p>
    <button type="button" onClick={reset}>重试读取</button>
  </main>;
}
