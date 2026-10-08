import { useRef, useState } from 'react';

/**
 * Two panes with a draggable divider (pointer, or arrow keys when focused;
 * double-click resets to 50/50). On narrow screens the panes stack instead.
 */
export default function SplitView({ left, right, ratio, onRatio, single }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (v) => Math.max(25, Math.min(75, v));

  return (
    <div ref={ref} className={`split${dragging ? ' dragging' : ''}${single ? ` single-${single}` : ''}`} style={{ '--split': `${ratio}%` }}>
      <div className="split-pane split-left">{left}</div>
      <div
        className="split-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(ratio)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging || !ref.current) return;
          const r = ref.current.getBoundingClientRect();
          onRatio(clamp(((e.clientX - r.left) / r.width) * 100));
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => onRatio(50)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') (e.preventDefault(), onRatio(clamp(ratio - 5)));
          if (e.key === 'ArrowRight') (e.preventDefault(), onRatio(clamp(ratio + 5)));
          if (e.key === 'Home') (e.preventDefault(), onRatio(50));
        }}
      />
      <div className="split-pane split-right">{right}</div>
    </div>
  );
}
