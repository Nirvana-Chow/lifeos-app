"use client";
import { useEffect, useRef, useState } from "react";
import { resources } from "../component-review/resources";
export function OverviewChart({
  pending,
  done,
  cancelled,
}: {
  pending: number;
  done: number;
  cancelled: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    const scope = resources();
    setError(false);
    void Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ])
      .then(([e, c, components, renderers]) => {
        if (stopped || !host.current) return;
        e.use([
          c.BarChart,
          components.GridComponent,
          components.TooltipComponent,
          components.AriaComponent,
          renderers.SVGRenderer,
        ]);
        const chart = e.init(host.current, undefined, { renderer: "svg" });
        scope.add(() => chart.dispose());
        const paint=()=>{if(!host.current)return;const style=getComputedStyle(host.current),color=(name:string)=>style.getPropertyValue(name).trim();chart.setOption({
          animation: false,
          aria: { enabled: true },
          grid: { left: 64, right: 30, top: 8, bottom: 8 },
          tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor:color("--card"), borderColor:color("--border"), textStyle:{color:color("--foreground")} },
          xAxis: { type: "value", minInterval: 1, show: false },
          yAxis: {
            type: "category",
            inverse: true,
            data: ["未完成", "已完成", "已取消"],
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 14, color: color("--muted-foreground") },
          },
          series: [
            {
              type: "bar",
              barWidth: 16,
              data: [
                { value: pending, itemStyle: { color: color("--foreground") } },
                { value: done, itemStyle: { color: color("--muted-foreground") } },
                { value: cancelled, itemStyle: { color: color("--input") } },
              ],
              label: {
                show: true,
                position: "right",
                fontSize: 14,
                color: color("--foreground"),
              },
              itemStyle: { borderRadius: 3 },
            },
          ],
        });};paint();
        const themeObserver=new MutationObserver(paint);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-lifeos-theme','style']});scope.add(()=>themeObserver.disconnect());
        const system=matchMedia('(prefers-color-scheme: dark)');system.addEventListener('change',paint);scope.add(()=>system.removeEventListener('change',paint));
        const observer = new ResizeObserver(() => chart.resize());
        scope.add(() => observer.disconnect());
        observer.observe(host.current);
      })
      .catch(() => {
        scope.release();
        if (!stopped) setError(true);
      });
    return () => {
      stopped = true;
      scope.release();
    };
  }, [pending, done, cancelled]);
  return (
    <div>
      {error ? (
        <p role="alert">图表加载失败，数值仍可查看。</p>
      ) : (
        <div
          className="lo-chart"
          ref={host}
          aria-label={`未完成 ${pending}，已完成 ${done}，已取消 ${cancelled}`}
        />
      )}
    </div>
  );
}
