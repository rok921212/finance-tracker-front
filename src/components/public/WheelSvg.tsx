import React, { useId } from "react";
import { motion } from "framer-motion";
import type { WheelSegment } from "../../lib/paymentsApi";

// SVG units; the wheel scales to its container
const C = 200;
const R = 188;
const RIM = 198;

/** Point on the circle at `deg` measured clockwise from 12 o'clock. */
const at = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)] as const;
};

const slicePath = (from: number, to: number) => {
  const [x0, y0] = at(from, R);
  const [x1, y1] = at(to, R);
  return `M${C},${C} L${x0},${y0} A${R},${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
};

// Dark text on light slices, white on dark ones
const textColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Rotation (degrees, always increasing) that brings the middle of slice `index` under the top pointer,
 * after `turns` full turns past `current`. `jitter` (-1..1) moves it off-center within the slice.
 */
export const rotationFor = (current: number, index: number, count: number, turns: number, jitter = 0) => {
  const slice = 360 / count;
  const target = (360 - (index * slice + slice / 2 + jitter * slice * 0.35) + 360) % 360;
  const base = Math.ceil(current / 360) * 360;
  return base + turns * 360 + target;
};

/** The wheel itself with a fixed pointer at the top. Spins to `rotation` over `duration` seconds. */
const WheelSvg: React.FC<{
  segments: WheelSegment[];
  rotation: number;
  duration: number;
  onSpinEnd?: () => void;
  className?: string;
}> = ({ segments, rotation, duration, onSpinEnd, className = "" }) => {
  const uid = useId().replace(/:/g, "");
  const n = segments.length;
  const slice = n ? 360 / n : 360;
  const fontSize = n <= 6 ? 15 : n <= 10 ? 12 : n <= 16 ? 9.5 : 8;
  const maxChars = n <= 6 ? 14 : n <= 12 ? 12 : 10;
  // Picture size: fits inside the slice near the rim
  const imgR = R * 0.74;
  const imgSize = Math.min(44, 2 * imgR * Math.sin(((slice / 2) * Math.PI) / 180) * 0.7);
  const hasImages = segments.some((s) => s.imageUrl);
  const textR = hasImages && imgSize >= 14 ? R * 0.45 : R * 0.6;

  return (
    <div className={`relative aspect-square w-full ${className}`}>
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={{ rotate: rotation }}
        transition={{ duration, ease: [0.12, 0.75, 0.12, 1] }}
        onAnimationComplete={onSpinEnd}
      >
        <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="w-full h-full drop-shadow-[0_0_25px_rgba(220,38,38,0.35)]" role="img" aria-label="Prize wheel">
          <circle cx={C} cy={C} r={RIM} fill="#111827" stroke="#dc2626" strokeWidth={4} />
          {n === 0 && <circle cx={C} cy={C} r={R} fill="#1f2937" />}
          {segments.map((s, i) => {
            const from = i * slice;
            const mid = from + slice / 2;
            const fg = textColor(s.color);
            const [tx, ty] = at(0, textR);
            const [ix, iy] = at(0, imgR);
            return (
              <g key={s.id}>
                <path d={slicePath(from, from + slice)} fill={s.color} stroke="#0b0f19" strokeWidth={1.5} />
                <g transform={`rotate(${mid} ${C} ${C})`}>
                  {s.imageUrl && imgSize >= 14 && (
                    <>
                      <clipPath id={`${uid}-img-${i}`}>
                        <circle cx={ix} cy={iy} r={imgSize / 2} />
                      </clipPath>
                      <circle cx={ix} cy={iy} r={imgSize / 2 + 2} fill="#ffffff" opacity={0.9} />
                      <image
                        href={s.imageUrl}
                        x={ix - imgSize / 2}
                        y={iy - imgSize / 2}
                        width={imgSize}
                        height={imgSize}
                        clipPath={`url(#${uid}-img-${i})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </>
                  )}
                  {/* Radial text, reading from the hub outwards */}
                  <text
                    x={tx}
                    y={ty}
                    transform={`rotate(-90 ${tx} ${ty})`}
                    textAnchor="middle"
                    fill={fg}
                    fontSize={fontSize}
                    fontWeight={700}
                    style={{ fontFamily: "inherit" }}
                  >
                    <tspan x={tx} dy={s.amount ? -fontSize * 0.25 : fontSize * 0.35}>
                      {clip(s.label, maxChars)}
                    </tspan>
                    {s.amount && (
                      <tspan x={tx} dy={fontSize * 1.1} fontSize={fontSize * 0.9} opacity={0.9}>
                        {clip(s.amount, maxChars)}
                      </tspan>
                    )}
                  </text>
                </g>
              </g>
            );
          })}
          {/* Rim lights */}
          {Array.from({ length: 24 }, (_, i) => {
            const [x, y] = at(i * 15, (R + RIM) / 2 + 1);
            return <circle key={i} cx={x} cy={y} r={2.6} fill={i % 2 ? "#fde68a" : "#ffffff"} />;
          })}
          <circle cx={C} cy={C} r={26} fill="#111827" stroke="#dc2626" strokeWidth={4} />
          <circle cx={C} cy={C} r={9} fill="#dc2626" />
        </svg>
      </motion.div>
      {/* Pointer: fixed, points down into the top slice */}
      <svg viewBox="0 0 40 48" className="absolute left-1/2 -translate-x-1/2 -top-[3%] w-[11%] drop-shadow-lg" aria-hidden="true">
        <path d="M20 46 L4 10 A18 18 0 0 1 36 10 Z" fill="#ffffff" stroke="#dc2626" strokeWidth={3} strokeLinejoin="round" />
        <circle cx="20" cy="14" r="5" fill="#dc2626" />
      </svg>
    </div>
  );
};

export default WheelSvg;
