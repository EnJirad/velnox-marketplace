import type { ReactNode } from "react";

interface ErrorStateProps {
  title?: string;
  message: string;
  retry?: ReactNode;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  retry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
        <span className="text-destructive text-2xl">!</span>
      </div>
      <h3 className="text-lg font-medium mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
      {retry && <div className="mt-4">{retry}</div>}
    </div>
  );
}
