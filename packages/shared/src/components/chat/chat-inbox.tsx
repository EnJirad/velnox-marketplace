/**
 * Chat inbox primitives — the list half of the Messages screen, shared so the
 * three apps cannot drift apart in spacing, dividers or touch targets.
 *
 * These are presentation only: each page keeps its own data source, filters and
 * navigation. A row renders exactly what it is given (name, avatar, preview,
 * time, unread count, and a presence dot ONLY when `online` is a boolean).
 */
import { ChevronLeft, Loader2, MessageCircle, MoreHorizontal, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@velnox/shared/lib/utils";
import { ChatAvatar } from "./chat-avatar";

export type ChatFilter = "all" | "unread" | "support";

/** Rounded search field used by every inbox. */
export function ChatSearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-11 w-full rounded-2xl bg-slate-100 pl-10 pr-10 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="×"
          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** All / Unread / Support — the tabs are real state, never decoration. */
export function ChatFilterTabs({
  value,
  onChange,
  labels,
  counts,
}: {
  value: ChatFilter;
  onChange: (filter: ChatFilter) => void;
  labels: Record<ChatFilter, string>;
  counts?: Partial<Record<ChatFilter, number>>;
}) {
  const order: ChatFilter[] = ["all", "unread", "support"];
  return (
    <div role="tablist" aria-label={labels.all} className="flex items-center gap-1.5">
      {order.map((filter) => {
        const count = counts?.[filter] ?? 0;
        const selected = value === filter;
        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(filter)}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors",
              selected
                ? "bg-sky-100 font-semibold text-sky-900"
                : "font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <span>{labels[filter]}</span>
            {filter === "unread" && count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold leading-4",
                  selected ? "bg-white/70 text-sky-900" : "bg-slate-200 text-slate-600",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** One conversation row: squircle avatar, name, preview, time, unread badge. */
export function ChatConversationRow({
  name,
  avatarUrl,
  preview,
  timeLabel,
  unread = 0,
  online,
  active = false,
  support = false,
  onClick,
}: {
  name: string;
  avatarUrl?: string | null;
  preview: string;
  timeLabel: string;
  unread?: number;
  online?: boolean | null;
  active?: boolean;
  support?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
        "border-b border-slate-100 last:border-b-0",
        active ? "bg-slate-50" : "hover:bg-slate-50 active:bg-slate-100",
      )}
    >
      <ChatAvatar name={name} src={avatarUrl} online={online} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold leading-5 text-slate-900">{name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{timeLabel}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px] leading-5",
              unread > 0 ? "font-medium text-slate-700" : "text-slate-500",
            )}
          >
            {preview}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {support && (
              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                Support
              </span>
            )}
            {unread > 0 && (
              <span className="min-w-5 rounded-full bg-sky-100 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-sky-900">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Loading / empty / error — an error never renders as an empty inbox. */
export function ChatListState({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {kind === "loading" ? (
        <Loader2 className="size-5 animate-spin text-slate-400" aria-hidden="true" />
      ) : (
        <MessageCircle className="size-7 text-slate-300" aria-hidden="true" />
      )}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="max-w-xs text-xs leading-5 text-slate-500">{description}</p>}
      {kind === "error" && actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 min-h-10 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Conversation header: back, avatar, name, presence, optional actions. */
export function ChatThreadHeader({
  name,
  avatarUrl,
  online,
  status,
  onBack,
  backLabel,
  actions,
}: {
  name: string;
  avatarUrl?: string | null;
  online?: boolean | null;
  status?: string | null;
  onBack?: () => void;
  backLabel: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-100 bg-white px-3 py-2.5 sm:px-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 md:hidden"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      <ChatAvatar name={name} src={avatarUrl} online={online} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-5 text-slate-900">{name}</p>
        {status ? (
          <p
            className={cn(
              "truncate text-xs leading-4",
              online === true ? "text-emerald-600" : "text-slate-500",
            )}
          >
            {status}
          </p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}

/** Small "more" affordance for the inbox header, matching the reference. */
export function ChatHeaderMenu({ children }: { children?: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {children}
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full text-slate-500"
      >
        <MoreHorizontal className="size-5" />
      </span>
    </span>
  );
}
