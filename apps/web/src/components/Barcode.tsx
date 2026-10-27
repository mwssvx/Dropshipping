import { code128Bars } from "@sf/core";

/** A Code 128 barcode as an SVG, with the code written under it. */
export function Barcode({ code, height = 40 }: { code: string; height?: number }) {
  const { bars, width } = code128Bars(code);
  return (
    <svg role="img" aria-label={`Barcode ${code}`} viewBox={`0 0 ${width} ${height + 12}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <rect width={width} height={height + 12} fill="#fff" />
      {bars.map(([x, w]) => <rect key={x} x={x} y={0} width={w} height={height} fill="#000" />)}
      <text x={width / 2} y={height + 10} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill="#000">{code}</text>
    </svg>
  );
}
