import {useId} from 'react';
import {formatFinanceAmount} from './domain';

const money = (minor: bigint) => `¥ ${formatFinanceAmount(minor.toString())}`;

const chartWidth = 640;
const chartHeight = 260;
const edgeMargin = 10;
const chartCenter = 126;
const sourceX = 150;
const targetX = 465;
const nodeDepth = 9;
const curveX = (sourceX + targetX) / 2;

function ribbon(from: number, to: number, width: number) {
  const fromEnd = from + width;
  const toEnd = to + width;
  return `M ${sourceX} ${from} C ${curveX} ${from} ${curveX} ${to} ${targetX} ${to}
    V ${toEnd} C ${curveX} ${toEnd} ${curveX} ${fromEnd} ${sourceX} ${fromEnd} Z`;
}

function FlowLabel({x, y, label, value, color, anchor}: {
  x: number; y: number; label: string; value: bigint; color: string; anchor?: 'end';
}) {
  const amount = money(value);
  const availableWidth = (anchor === 'end' ? x : chartWidth - x) - edgeMargin;
  const fittedWidth = amount.length * 12 > availableWidth ? availableWidth : undefined;
  return (
    <text x={x} y={y - 4} textAnchor={anchor} fill={color} fontSize="17" fontWeight="600">
      {label}
      <tspan x={x} dy="23" fontSize="20" fontWeight="700"
        textLength={fittedWidth} lengthAdjust="spacingAndGlyphs">{amount}</tspan>
    </text>
  );
}

export function RecordedFlowDiagram({income, netExpense, difference}: {
  income: bigint; netExpense: bigint; difference: bigint;
}) {
  const titleId = useId();
  const descriptionId = useId();
  if (income === 0n || netExpense < 0n) {
    return <p>记录收入 {money(income)} · 净支出 {money(netExpense)} · {difference < 0n ? '记录缺口' : '记录结余'} {money(difference < 0n ? -difference : difference)}。{netExpense < 0n ? '本期退款超过支出。' : '本期没有记录收入。'}</p>;
  }
  const deficit = difference < 0n;
  const largestAmount = deficit ? netExpense : income;
  const scale = 160 / Number(largestAmount);
  const incomeWidth = Number(income) * scale;
  const expenseWidth = Number(netExpense) * scale;
  const coveredWidth = deficit ? incomeWidth : expenseWidth;
  const remainderWidth = Math.abs(Number(difference)) * scale;
  const start = chartCenter - incomeWidth / 2;
  const expenseStart = deficit ? chartCenter - expenseWidth / 2 : Math.max(edgeMargin, 62 - expenseWidth / 2);
  const surplusStart = Math.min(187 - remainderWidth / 2, chartHeight - edgeMargin - remainderWidth);
  const gapStart = expenseStart + coveredWidth;
  const labelX = targetX + 34;

  return (
    <svg role="img" aria-labelledby={titleId} aria-describedby={descriptionId}
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      style={{display: 'block', width: '100%', height: 'auto', margin: '1rem auto 0.25rem', background: '#f7faf8', borderRadius: '0.65rem'}}>
      <title id={titleId}>记录收支流向图</title>
      <desc id={descriptionId}>
        {deficit
          ? `记录收入 ${money(income)} 流向净支出。净支出共 ${money(netExpense)}，虚线标记收入未覆盖的 ${money(-difference)} 缺口。`
          : `记录收入 ${money(income)} 分为净支出 ${money(netExpense)} 和记录结余 ${money(difference)}。两条流带的宽度按各自金额成比例绘制。`}
      </desc>
      <path data-flow="net-expense" d={ribbon(start, expenseStart, coveredWidth)} fill="#85a9ca" />
      {!deficit && (
        <path data-flow="recorded-surplus" d={ribbon(start + coveredWidth, surplusStart, remainderWidth)} fill="#79bb98" />
      )}
      <rect data-flow-node="income" x={sourceX - nodeDepth} y={start} width={nodeDepth}
        height={incomeWidth} rx="2" fill="#243d3f" />
      <rect data-flow-node="net-expense" x={targetX} y={expenseStart} width={nodeDepth}
        height={coveredWidth} rx="2" fill="#355e86" />
      {deficit ? (
        <>
          <rect data-flow-gap="recorded-deficit" x={targetX} y={gapStart} width={nodeDepth}
            height={remainderWidth} rx="2" fill="#fff5e9" stroke="#984315" strokeWidth="1.5" strokeDasharray="3 2" />
          <path d={`M ${targetX + nodeDepth} ${gapStart + remainderWidth / 2} H ${labelX - 8}`}
            fill="none" stroke="#984315" strokeDasharray="3 2" />
          <FlowLabel x={labelX} y={expenseStart + coveredWidth / 2} label="净支出" value={netExpense} color="#28496b" />
          <FlowLabel x={labelX} y={gapStart + remainderWidth / 2} label="记录缺口" value={-difference} color="#863c15" />
        </>
      ) : (
        <>
          <rect data-flow-node="recorded-surplus" x={targetX} y={surplusStart} width={nodeDepth}
            height={remainderWidth} rx="2" fill="#256747" />
          <FlowLabel x={labelX} y={expenseStart + expenseWidth / 2} label="净支出" value={netExpense} color="#28496b" />
          <FlowLabel x={labelX} y={surplusStart + remainderWidth / 2} label="记录结余" value={difference} color="#205c3e" />
        </>
      )}
      <FlowLabel x={sourceX - nodeDepth - 17} y={chartCenter} label="记录收入" value={income} color="#243d3f" anchor="end" />
    </svg>
  );
}
