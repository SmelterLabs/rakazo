import { t } from "@lingui/core/macro";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "rakazo:right-panel-width";
const MIN_WIDTH = 320;
function maximumWidth() {
  return Math.max(MIN_WIDTH, Math.min(1000, window.innerWidth - 320));
}
function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(maximumWidth(), width));
}

export function ResizableSidePanel({
  open,
  panel,
  children,
}: {
  open: boolean;
  panel: string;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      return clampWidth(saved >= MIN_WIDTH ? saved : 384);
    } catch {
      return 384;
    }
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number; direction: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      /* Storage may be disabled. */
    }
  }, [width]);
  useEffect(() => {
    const resize = () => setWidth((current) => clampWidth(current));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  function stopDrag(event: PointerEvent<HTMLHRElement>) {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <aside
      data-testid="side-panel"
      data-panel={panel}
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      className={`absolute inset-y-0 end-0 z-20 flex min-h-0 shrink-0 flex-col overflow-hidden bg-background md:relative ${dragging ? "" : "transition-[width] duration-150 ease-out"} ${open ? "w-full max-w-[384px] border-s border-sidebar-border md:w-(--panel-width) md:max-w-none" : "pointer-events-none w-0"}`}
    >
      {open ? (
        <hr
          tabIndex={0}
          aria-label={t`Resize panel`}
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={maximumWidth()}
          aria-valuenow={Math.round(width)}
          className="absolute inset-y-0 start-0 z-30 m-0 hidden h-full w-2 touch-none cursor-col-resize border-0 bg-transparent hover:bg-border focus-visible:bg-border focus-visible:outline-none md:block"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              x: event.clientX,
              width,
              direction: document.documentElement.dir === "rtl" ? -1 : 1,
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              setWidth(
                clampWidth(
                  drag.current.width + (drag.current.x - event.clientX) * drag.current.direction,
                ),
              );
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
          onKeyDown={(event) => {
            const direction = document.documentElement.dir === "rtl" ? -1 : 1;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setWidth((current) =>
                clampWidth(current + (event.key === "ArrowLeft" ? 32 : -32) * direction),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              setWidth(MIN_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setWidth(maximumWidth());
            }
          }}
        />
      ) : null}
      {children}
    </aside>
  );
}
