import * as React from "react";
import { cn } from "@/lib/utils";

const MIN_HEIGHT = 132; // roughly 5-6 lines
const MAX_HEIGHT = 320; // roughly 12-15 lines; scrolls internally past this

/**
 * Auto-growing writing textarea, ChatGPT/Claude/Notion-AI style: no native
 * resize handle, starts around 5-6 lines, grows with content up to
 * MAX_HEIGHT, then scrolls internally with a thin custom scrollbar.
 */
function Textarea({
  className,
  onChange,
  value,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  }, []);

  // Controlled value changes (including programmatic resets) must resize
  // too, not just user keystrokes routed through onChange.
  React.useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      rows={1}
      className={cn(
        "fa-textarea-scroll flex w-full resize-none overflow-y-auto rounded-xl border border-input bg-transparent px-4 py-3.5 text-sm leading-relaxed shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] transition-[height,border-color] duration-150 ease-out placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
      {...props}
    />
  );
}

export { Textarea };
