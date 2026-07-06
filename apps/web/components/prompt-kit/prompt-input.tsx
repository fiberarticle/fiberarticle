"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PromptInputContextValue {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number;
  onSubmit?: () => void;
}

const PromptInputContext = React.createContext<PromptInputContextValue>({
  isLoading: false,
  value: "",
  setValue: () => {},
  maxHeight: 240,
});

function usePromptInput() {
  return React.useContext(PromptInputContext);
}

interface PromptInputProps extends React.HTMLAttributes<HTMLDivElement> {
  isLoading?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: () => void;
  maxHeight?: number;
}

function PromptInput({
  className,
  isLoading = false,
  value,
  onValueChange,
  onSubmit,
  maxHeight = 240,
  children,
  ...props
}: PromptInputProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <PromptInputContext.Provider
        value={{ isLoading, value, setValue: onValueChange, maxHeight, onSubmit }}
      >
        <div
          className={cn(
            "cursor-text rounded-3xl border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-shadow focus-within:border-ring focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.09)]",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  );
}

function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  disableAutosize?: boolean;
}) {
  const { value, setValue, maxHeight, onSubmit } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      maxHeight
    )}px`;
  }, [value, maxHeight, disableAutosize]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit?.();
        }
        onKeyDown?.(e);
      }}
      rows={1}
      className={cn(
        "w-full resize-none border-none bg-transparent px-4 pt-3 text-base outline-none placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function PromptInputActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props} />
  );
}

function PromptInputAction({
  tooltip,
  children,
  side = "top",
}: {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
};
