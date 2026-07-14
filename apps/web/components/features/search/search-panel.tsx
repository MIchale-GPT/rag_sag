"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  History,
  Library,
  List,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getSearchStrategy,
  type SearchStrategy,
} from "@/lib/retrieval-config";
import { cn } from "@/lib/utils";
import type {
  ActivityItem,
  Citation,
  SearchEvent,
  SearchResponse,
  Section,
  Source,
} from "@/lib/types";
import { useDetailPanel } from "@/components/features/detail-panel";
import { MarkdownContent } from "@/components/features/markdown-content";
import {
  useSearchWorkspace,
  type SearchContentView,
  type SearchRunIntent,
} from "@/components/features/search/search-provider";
import { SearchStrategyControl } from "@/components/features/search-strategy-control";
import { DocStatusBadge } from "@/components/features/status-badge";
import { EmptyState } from "@/components/features/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// 图谱视图较重，按需加载。
const SearchGraph = dynamic(() => import("@/components/features/search-graph"), {
  ssr: false,
  loading: () => <Skeleton className="h-[560px] rounded-lg" />,
});

function mentionTerm(query: string): string | null {
  const at = query.lastIndexOf("@");
  if (at < 0) return null;
  const term = query.slice(at + 1);
  return /\s/.test(term) ? null : term;
}

function removeMentionTerm(query: string): string {
  const at = query.lastIndexOf("@");
  if (at < 0) return query;
  const before = query.slice(0, at).trimEnd();
  return before ? `${before} ` : "";
}

/** 检索扫描动画：骨架行 1→N 铺开、随机高亮、清空、再来——「翻找数据」的具象化。 */
function SearchScanning() {
  const t = useTranslations("Search");
  const [rows, setRows] = React.useState(1);
  const [lit, setLit] = React.useState<Set<number>>(new Set());
  React.useEffect(() => {
    let n = 1;
    const grow = window.setInterval(() => {
      n = n >= 6 ? 1 : n + 1;
      setRows(n);
      const picks = new Set<number>();
      const count = n <= 2 ? 1 : 2 + (n % 2);
      while (picks.size < Math.min(count, n)) picks.add(Math.floor(Math.random() * n));
      setLit(picks);
    }, 420);
    return () => window.clearInterval(grow);
  }, []);
  return (
    <div
      className="flex flex-col gap-1.5 overflow-hidden rounded-lg border p-3"
      role="status"
      aria-live="polite"
      aria-label={t("searching")}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "h-8 rounded-md transition-[opacity,background-color,box-shadow] duration-300",
            i < rows ? "opacity-100" : "opacity-25",
            lit.has(i) ? "bg-primary/15 ring-1 ring-primary/25" : "bg-muted",
            "motion-reduce:bg-muted motion-reduce:opacity-100 motion-reduce:ring-0 motion-reduce:transition-none",
          )}
        />
      ))}
      <p className="pt-1 text-center text-xs text-muted-foreground">{t("scanning")}</p>
    </div>
  );
}

const ROW_CARD =
  "group flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left shadow-soft outline-none transition-all hover:bg-muted/35 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring";
const ACTIVITY_PAGE_SIZE = 6;

function ActivityCard({
  item,
  compact,
  interactive,
  onOpen,
}: {
  item: ActivityItem;
  compact: boolean;
  interactive: boolean;
  onOpen?: (item: ActivityItem) => void;
}) {
  const t = useTranslations("Search");
  const { open } = useDetailPanel();
  const Icon = FileText;
  const cardClass = cn(
    "group flex w-full items-center gap-3 text-left outline-none transition-colors",
    compact ? "px-3 py-2.5" : "px-4 py-3",
    interactive && "hover:bg-muted/35 focus-visible:bg-muted/45",
  );
  const body = (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 max-w-full truncate text-sm font-medium text-foreground">
            {item.title}
          </span>
          {item.status && <DocStatusBadge status={item.status} />}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {item.subtitle || t("document")}
        </span>
      </span>
      {interactive && (
        compact ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            {t("viewDetails")}
            <ArrowUpRight className="size-3" />
          </span>
        )
      )}
    </>
  );

  if (!interactive) {
    return (
      <div data-activity-item={item.id} className={cardClass}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-activity-item={item.id}
      disabled={!item.source_id}
      onClick={() => {
        if (!item.source_id) return;
        if (onOpen) {
          onOpen(item);
          return;
        }
        open({
          kind: "document",
          sourceId: item.source_id,
          documentId: item.id,
          title: item.title,
        });
      }}
      className={cardClass}
    >
      {body}
    </button>
  );
}

function ActivityTimeline({
  items,
  compact,
  interactive,
  onItemOpen,
}: {
  items: ActivityItem[] | null;
  compact: boolean;
  interactive: boolean;
  onItemOpen?: (item: ActivityItem) => void;
}) {
  const t = useTranslations("Search");
  const [visibleCount, setVisibleCount] = React.useState(ACTIVITY_PAGE_SIZE);
  const orderedItems = React.useMemo(() => {
    if (!items) return [];
    return items
      .map((item, index) => ({
        item,
        index,
        timestamp: Date.parse(item.at),
      }))
      .sort((left, right) => {
        const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : 0;
        const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : 0;
        return rightTime - leftTime || left.index - right.index;
      })
      .map(({ item }) => item);
  }, [items]);

  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title={t("noRecentActivity")}
        description={t("recentActivityDescription")}
      />
    );
  }

  const visibleItems = orderedItems.slice(0, visibleCount);
  const remaining = Math.max(orderedItems.length - visibleItems.length, 0);

  return (
    <div
      data-activity-list="recent"
      className="overflow-hidden rounded-lg border border-border/70 bg-card/45"
    >
      {visibleItems.map((item, index) => (
        <div key={`${item.type}-${item.id}`} className={cn(index > 0 && "border-t border-border/60")}>
          <ActivityCard
            item={item}
            compact={compact}
            interactive={interactive}
            onOpen={onItemOpen}
          />
        </div>
      ))}
      {remaining > 0 && (
        <div className="border-t border-border/60 p-1.5">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(current + ACTIVITY_PAGE_SIZE, orderedItems.length),
              )
            }
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("moreActivityAria", { count: remaining })}
          >
            {t("viewMore")}
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function SearchHistoryList({
  queries,
  compact,
  onSelect,
  onRemove,
  onClear,
}: {
  queries: string[];
  compact: boolean;
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("Search");
  const pageSize = 5;
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);

  if (queries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t("noHistory")}
        description={t("historyDescription")}
      />
    );
  }

  const shownQueries = queries.slice(0, visibleCount);
  const remaining = Math.max(queries.length - shownQueries.length, 0);
  const canCollapse = remaining === 0 && queries.length > pageSize;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-xs text-muted-foreground">
          {t("localRecords", { count: queries.length })}
        </span>
        <button
          type="button"
          onClick={() => setClearConfirmOpen(true)}
          className="rounded px-1.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("clearAll")}
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/45">
        {shownQueries.map((query, index) => (
          <div
            key={query}
            className={cn(
              "group flex w-full items-center transition-colors hover:bg-muted/35 focus-within:bg-muted/35",
              index > 0 && "border-t border-border/60",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(query)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                compact ? "px-3 py-2.5" : "px-4 py-3",
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
                <History className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {query}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(query)}
              className="mr-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/65 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("deleteHistoryAria", { query })}
              title={t("delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {(remaining > 0 || canCollapse) && (
        <button
          type="button"
          onClick={() =>
            setVisibleCount((current) =>
              remaining > 0 ? Math.min(current + pageSize, queries.length) : pageSize,
            )
          }
          className="mx-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={remaining === 0}
        >
          {remaining > 0 ? (
            <>
              {t("expandMore")}
              <ChevronDown className="size-3.5" />
            </>
          ) : (
            <>
              {t("collapse")}
              <ChevronUp className="size-3.5" />
            </>
          )}
        </button>
      )}
      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t("clearHistoryTitle")}
        description={t("clearHistoryDescription", { count: queries.length })}
        confirmLabel={t("clearAll")}
        onConfirm={onClear}
      />
    </div>
  );
}

function sectionCitation(section: Section, index: number): Citation {
  return {
    n: index + 1,
    chunk_id: section.chunk_id,
    heading: section.heading,
    snippet: section.content,
    score: section.score,
    source_id: section.source_id,
    source_name: section.source_name,
  };
}

function ResultList({
  result,
  onEventClick,
  onCitationClick,
  compact,
}: {
  result: SearchResponse;
  onEventClick?: (event: SearchEvent, result: SearchResponse) => void;
  onCitationClick?: (citation: Citation, result: SearchResponse) => void;
  compact: boolean;
}) {
  const t = useTranslations("Search");
  const { open } = useDetailPanel();
  if (result.events.length === 0 && result.sections.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={t("noEvidence")}
        description={t("noEvidenceDescription")}
      />
    );
  }
  if (result.events.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {result.sections.map((section, index) => {
          const citation = sectionCitation(section, index);
          return (
            <button
              key={`${section.source_id}:${section.chunk_id}:${index}`}
              type="button"
              disabled={!section.chunk_id || !section.source_id}
              onClick={() => {
                if (onCitationClick) {
                  onCitationClick(citation, result);
                  return;
                }
                if (!section.chunk_id || !section.source_id) return;
                open({
                  kind: "chunk",
                  sourceId: section.source_id,
                  chunkId: section.chunk_id,
                  heading: section.heading,
                  sourceName: section.source_name ?? undefined,
                });
              }}
              className={cn(
                ROW_CARD,
                compact && "gap-2 px-3",
                "disabled:cursor-default disabled:hover:bg-card disabled:hover:shadow-soft",
              )}
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-xs text-primary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {section.heading || t("relatedMaterial")}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {section.score.toFixed(3)}
                  </span>
                </span>
                <span className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {section.content}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {result.events.map((event) => (
        <button
          key={event.id}
          type="button"
          disabled={!event.chunk_id || !event.source_id}
          onClick={() => {
            if (onEventClick) {
              onEventClick(event, result);
              return;
            }
            if (!event.chunk_id || !event.source_id) return;
            open({
              kind: "chunk",
              sourceId: event.source_id,
              chunkId: event.chunk_id,
              heading: event.title,
              sourceName: event.source_name ?? undefined,
            });
          }}
          className={cn(
            ROW_CARD,
            compact && "gap-2 px-3",
            "disabled:cursor-default disabled:hover:bg-card disabled:hover:shadow-soft",
          )}
        >
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <Sparkles className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {event.title || t("unnamedEvent")}
              </span>
              {!compact && event.category && (
                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  {event.category}
                </span>
              )}
              {!compact && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {event.source_name}
                </span>
              )}
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {event.score.toFixed(3)}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {event.summary || t("noEventSummary")}
            </span>
          </span>
          {!compact && event.chunk_id && event.source_id && (
            <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              {t("viewOriginal")}
              <ArrowUpRight className="size-3" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function SearchSummaryCard({
  summary,
  citations,
  compact,
  streaming,
  onCitationClick,
}: {
  summary: string;
  citations: Citation[];
  compact: boolean;
  streaming: boolean;
  onCitationClick: (citation: Citation) => void;
}) {
  const t = useTranslations("Search");
  const [expanded, setExpanded] = React.useState(true);
  const [canExpand, setCanExpand] = React.useState(false);
  const [expandedScrollable, setExpandedScrollable] = React.useState(false);
  const [following, setFollowing] = React.useState(true);
  const [streamLayoutLocked, setStreamLayoutLocked] = React.useState(streaming);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const followOutputRef = React.useRef(true);
  const wasStreamingRef = React.useRef(streaming);
  const contentId = React.useId();
  const hintId = `${contentId}-hint`;
  const accessiblePreview = summary
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const accessiblePreviewExcerpt = accessiblePreview.length > 240
    ? `${accessiblePreview.slice(0, 240).trimEnd()}…`
    : accessiblePreview;

  const updateFollowing = React.useCallback((next: boolean) => {
    followOutputRef.current = next;
    setFollowing((current) => (current === next ? current : next));
  }, []);

  const scrollToLatest = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateFollowing(true);
    viewport.scrollTop = viewport.scrollHeight;
  }, [updateFollowing]);

  React.useLayoutEffect(() => {
    if (streaming && !wasStreamingRef.current) {
      setExpanded(true);
      setStreamLayoutLocked(true);
      updateFollowing(true);
    } else if (!streaming && wasStreamingRef.current) {
      // Streaming reserves a stable viewport to avoid page jitter. Once the
      // final answer arrives, release that temporary height while preserving
      // the user's expanded state. Answers only collapse through an explicit
      // user action, so completed output remains immediately readable.
      setStreamLayoutLocked(false);
      updateFollowing(true);
    }
    wasStreamingRef.current = streaming;
  }, [streaming, updateFollowing]);

  const collapsedLimit = compact ? 72 : 96;

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const update = () => {
      const expandedLimit = compact
        ? Math.min(288, Math.max(176, window.innerHeight * 0.42))
        : Math.min(280, Math.max(176, window.innerHeight * 0.32));
      const contentHeight = content.scrollHeight;
      const nextCanExpand = contentHeight > collapsedLimit + 1;
      const nextScrollable = expanded && contentHeight > expandedLimit + 1;
      setCanExpand((current) => (current === nextCanExpand ? current : nextCanExpand));
      setExpandedScrollable((current) => (current === nextScrollable ? current : nextScrollable));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [collapsedLimit, compact, expanded]);

  React.useLayoutEffect(() => {
    if (!streaming || !expanded || !followOutputRef.current) return;
    const frame = requestAnimationFrame(() => {
      // The user may scroll up after this frame was queued. Re-check here so
      // programmatic following never wins that race and pulls them back down.
      if (followOutputRef.current) scrollToLatest();
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, scrollToLatest, streaming, summary]);

  const collapsed = canExpand && !expanded;
  const expandedScrollRegion = expanded && expandedScrollable;
  const streamHeight = compact ? "7.5rem" : "10rem";
  const maxHeight = streamLayoutLocked && expanded
    ? streamHeight
    : !expanded
      ? `${collapsedLimit}px`
      : compact
        ? "clamp(11rem, 42dvh, 18rem)"
        : "clamp(11rem, 32dvh, 17.5rem)";

  return (
    <div
      className={cn(
        "shrink-0 rounded-lg border border-amber-500/15 bg-amber-500/[0.04]",
        compact ? "px-3 py-2.5" : "px-4 py-3",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
          role={streaming ? "status" : undefined}
          aria-live={streaming ? "polite" : undefined}
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="truncate">
            {streaming ? t("generatingAnswer") : t("evidenceAnswer")}
          </span>
          {streaming && <Spinner className="size-3 text-amber-600/70 dark:text-amber-300/70" />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {streaming && expanded && !following && (
            <button
              type="button"
              onClick={scrollToLatest}
              className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("followOutput")}
            </button>
          )}
          {summary && (canExpand || streaming || (streamLayoutLocked && expanded)) && (
            <button
              type="button"
              onClick={() => {
                const next = !expanded;
                setExpanded(next);
                if (!next) setStreamLayoutLocked(false);
                else if (streaming) setStreamLayoutLocked(true);
                if (streaming) updateFollowing(next);
              }}
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-describedby={collapsed ? hintId : undefined}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? t("collapse") : t("expandAnswer")}
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      <div
        ref={viewportRef}
        id={contentId}
        inert={collapsed || undefined}
        aria-hidden={collapsed || undefined}
        aria-label={expandedScrollRegion ? t("fullAnswerScrollable") : undefined}
        role={expandedScrollRegion ? "region" : undefined}
        tabIndex={expandedScrollRegion ? 0 : undefined}
        onScroll={(event) => {
          if (!streaming || !expanded) return;
          const viewport = event.currentTarget;
          const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
          updateFollowing(distance <= 32);
        }}
        className={cn(
          "text-sm leading-6 text-foreground/80",
          summary && "mt-1.5",
          !expanded && "overflow-hidden",
          expanded && "overflow-y-auto overscroll-contain pr-1 outline-none [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-ring",
        )}
        style={{
          maxHeight,
          height: streamLayoutLocked && expanded && summary ? maxHeight : undefined,
          WebkitMaskImage: collapsed
            ? "linear-gradient(to bottom, black 0, black calc(100% - 2rem), transparent 100%)"
            : undefined,
          maskImage: collapsed
            ? "linear-gradient(to bottom, black 0, black calc(100% - 2rem), transparent 100%)"
            : undefined,
        }}
      >
        <div ref={contentRef}>
          {summary ? (
            <MarkdownContent
              content={summary}
              citations={citations}
              onCitationClick={onCitationClick}
              streaming={streaming}
            />
          ) : null}
        </div>
      </div>
      {collapsed && (
        <span id={hintId} className="sr-only">
          {t("collapsedPreview", { preview: accessiblePreviewExcerpt })}
        </span>
      )}
    </div>
  );
}

export interface SearchPanelProps {
  active?: boolean;
  initialQuery?: string;
  initialSourceId?: string | null;
  saveInitialExploration?: boolean;
  showCancel?: boolean;
  showGraphView?: boolean;
  showRecentActivity?: boolean;
  showContentSwitcher?: boolean;
  activityInteractive?: boolean;
  onCancel?: () => void;
  onSearchStart?: (query: string) => void;
  onSearchComplete?: (result: SearchResponse) => void;
  onSearchError?: (message: string) => void;
  onSearchCancel?: () => void;
  onActivityClick?: (item: ActivityItem) => void;
  onEventClick?: (event: SearchEvent, result: SearchResponse) => void;
  onCitationClick?: (citation: Citation, result: SearchResponse) => void;
  className?: string;
}

/** Complete adaptive search surface shared by the main workspace and mini entry. */
export function SearchPanel({
  active = true,
  initialQuery = "",
  initialSourceId,
  saveInitialExploration = false,
  showCancel = false,
  showGraphView = true,
  showRecentActivity = true,
  showContentSwitcher = true,
  activityInteractive = true,
  onCancel,
  onSearchStart,
  onSearchComplete,
  onSearchError,
  onSearchCancel,
  onActivityClick,
  onEventClick,
  onCitationClick,
  className,
}: SearchPanelProps) {
  const t = useTranslations("Search");
  const searchStrategies = useTranslations("SearchStrategies");
  const search = useSearchWorkspace();
  const ensureSources = search.ensureSources;
  const { open } = useDetailPanel();
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [view, setView] = React.useState<"list" | "graph">("graph");
  const [compact, setCompact] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hydrationKeyRef = React.useRef("");
  const contentView = search.contentView;
  const changeContentView = search.setContentView;

  const executeSearch = React.useCallback(
    async (options: {
      query?: string;
      topK?: number;
      strategy?: SearchStrategy;
      sourceIds?: string[];
      saveExploration?: boolean;
      intent?: SearchRunIntent;
    } = {}) => {
      const query = (options.query ?? search.query).trim();
      if (!query) {
        search.clear();
        return null;
      }
      setMentionOpen(false);
      changeContentView("results");
      onSearchStart?.(query);
      try {
        const result = await search.run(options);
        if (result) onSearchComplete?.(result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : t("failed");
        if (onSearchError) onSearchError(message);
        else if (options.intent === "load-more") toast.error(message);
        return null;
      }
    },
    [changeContentView, onSearchComplete, onSearchError, onSearchStart, search, t],
  );

  React.useEffect(() => {
    if (showRecentActivity) void search.ensureActivity();
    const seedQuery = initialQuery.trim();
    const hydrationKey = `${seedQuery}\u0000${initialSourceId ?? ""}`;
    if (!seedQuery || hydrationKeyRef.current === hydrationKey) {
      if (active) inputRef.current?.focus();
      return;
    }
    let cancelled = false;
    void ensureSources().then((sources) => {
      if (cancelled) return;
      if (hydrationKeyRef.current === hydrationKey) return;
      hydrationKeyRef.current = hydrationKey;
      const source = initialSourceId
        ? sources.find((item) => item.id === initialSourceId)
        : undefined;
      const sourceIds = source ? [source.id] : undefined;
      if (source) search.setScope([{ id: source.id, name: source.name }]);
      search.setQuery(seedQuery);
      void executeSearch({
        query: seedQuery,
        sourceIds,
        saveExploration: saveInitialExploration,
      });
    });
    return () => {
      cancelled = true;
    };
    // The URL seed is consumed once; live search state is owned by SearchProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialQuery, initialSourceId, saveInitialExploration, showRecentActivity]);

  React.useEffect(() => {
    void ensureSources();
    if (active) inputRef.current?.focus();
  }, [active, ensureSources]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const next = root.getBoundingClientRect().width < 520;
      setCompact((current) => (current === next ? current : next));
    };
    update();
    // Use the border box: compact mode changes this same node's padding, so
    // observing contentRect would make the 520px breakpoint feed back into
    // itself and oscillate forever when a list scrollbar appears.
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const term = mentionTerm(search.query);
  const filteredSources = React.useMemo(() => {
    const needle = (term ?? "").trim().toLowerCase();
    return search.sources.filter((source) =>
      !needle || source.name.toLowerCase().includes(needle),
    );
  }, [search.sources, term]);
  React.useEffect(() => {
    if (!mentionOpen) return;
    if (term === null) {
      setMentionOpen(false);
      return;
    }
    setMentionIndex(0);
  }, [mentionOpen, term]);

  const chooseSource = React.useCallback((source: Source | undefined) => {
    if (!source) return;
    search.toggleSource(source);
    search.setQuery(removeMentionTerm(search.query));
    setMentionOpen(false);
    setMentionIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [search]);

  function changeStrategy(value: SearchStrategy) {
    if (value === search.strategy) return;
    search.setStrategy(value);
    const activeQuery = search.query.trim() || search.lastQuery;
    if ((search.result !== null || search.busy) && activeQuery) {
      void executeSearch({
        query: activeQuery,
        strategy: value,
        saveExploration: false,
      });
    }
  }

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    await executeSearch({
      saveExploration: false,
    });
  }

  async function loadMore() {
    if (!search.canLoadMore) return;
    await executeSearch({
      intent: "load-more",
      topK: search.topK + 12,
      saveExploration: false,
    });
  }

  const activeView = showGraphView ? view : "list";
  const graphViewActive = activeView === "graph" && Boolean(search.result?.events.length);
  const citations = React.useMemo(
    () => search.result?.sections.map(sectionCitation) ?? [],
    [search.result],
  );
  const resultStatus =
    search.phase === "loading-more"
      ? t("loadingMoreEvidence")
      : search.busy && search.result === null
        ? t("retrievingEvidence")
        : search.result
          ? t("selectedEvidence", { count: search.result.sections.length })
          : "";

  return (
    <div
      ref={rootRef}
      data-compact={compact || undefined}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-y-auto [scrollbar-gutter:stable]",
        compact ? "gap-3 p-3" : "gap-6 p-6",
        graphViewActive && "h-full min-h-0 overflow-hidden",
        className,
      )}
    >
      <form onSubmit={run} className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2">
        <div className="flex w-full items-center gap-2">
          <div className="relative flex-1">
            <div
              className={cn(
                "flex min-h-11 items-center gap-1 rounded-lg border border-input bg-card py-1.5 pl-10 pr-2 shadow-soft transition-[border-color,box-shadow]",
                "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
              )}
            >
              <button
                type="submit"
                aria-label={t("search")}
                disabled={!search.query.trim() || search.busy}
                className="absolute left-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              >
                <SearchIcon className="size-4" />
              </button>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {search.scoped.map((sc) => (
                  <span
                    key={sc.id}
                    className="inline-flex max-w-[min(100%,12rem)] items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                  >
                    <Library className="size-3 shrink-0" />
                    <span className="truncate">{sc.name}</span>
                    <button
                      type="button"
                      aria-label={t("removeSource", { name: sc.name })}
                      onClick={() => search.removeSource(sc.id)}
                      className="rounded-sm text-primary/70 hover:bg-primary/15 hover:text-primary"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  type="text"
                  autoFocus={active}
                  value={search.query}
                  onChange={(e) => {
                    const v = e.target.value;
                    const nextMentionOpen = mentionTerm(v) !== null;
                    const cancelledSearch = search.busy && !v.trim();
                    search.setQuery(v);
                    if (cancelledSearch) onSearchCancel?.();
                    setMentionOpen(nextMentionOpen);
                  }}
                  onKeyDown={(e) => {
                    if (mentionOpen) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => (filteredSources.length ? (i + 1) % filteredSources.length : 0));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) =>
                          filteredSources.length ? (i - 1 + filteredSources.length) % filteredSources.length : 0,
                        );
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        chooseSource(filteredSources[mentionIndex]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMentionOpen(false);
                        return;
                      }
                    }
                    if (e.key === "@") {
                      setMentionOpen(true);
                      setMentionIndex(0);
                    }
                  }}
                  placeholder={search.scoped.length ? t("continueKeywords") : t("placeholder")}
                  className="min-w-[8ch] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              {search.query && (
                <button
                  type="button"
                  onClick={() => {
                    const cancelledSearch = search.busy;
                    search.clear();
                    if (cancelledSearch) onSearchCancel?.();
                    setMentionOpen(false);
                    inputRef.current?.focus();
                  }}
                  aria-label={t("clear")}
                  className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              )}
              <SearchStrategyControl
                value={search.strategy}
                defaultValue={search.defaultStrategy}
                onValueChange={changeStrategy}
              />
            </div>
            {mentionOpen && (
              <div className="absolute left-0 top-full z-20 mt-2 w-full">
                <div className="overflow-hidden rounded-lg border bg-card shadow-lift">
                  <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    {t("knowledgeScope")}
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1" role="listbox">
                    {filteredSources.length === 0 ? (
                      <p className="px-3 py-5 text-center text-sm text-muted-foreground">{t("noMatchingSources")}</p>
                    ) : (
                      filteredSources.map((s, index) => {
                        const on = search.scoped.some((x) => x.id === s.id);
                        const active = index === mentionIndex;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setMentionIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseSource(s)}
                            className={cn(
                              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors",
                              active && "bg-muted text-foreground",
                            )}
                          >
                            <Library className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            {on && <span className="text-xs text-muted-foreground">{t("selected")}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          {showCancel && (
            <button
              type="button"
              onClick={() => {
                search.cancel();
                onSearchCancel?.();
                onCancel?.();
              }}
              className="shrink-0 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("cancel")}
            </button>
          )}
        </div>
      </form>

      {showRecentActivity && showContentSwitcher && (
        <div className="mx-auto flex w-full max-w-3xl items-center px-1">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={contentView}
            onValueChange={(value) =>
              value && changeContentView(value as SearchContentView)
            }
            aria-label={t("contentPanelAria")}
          >
            <ToggleGroupItem
              value="history"
              className="gap-1.5 px-3"
              disabled={search.busy}
            >
              <History className="size-3.5" />
              {t("history")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="activity"
              className="gap-1.5 px-3"
              disabled={search.busy}
            >
              <List className="size-3.5" />
              {t("recentActivity")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {contentView === "results" && search.busy && search.result === null ? (
        <div className="mx-auto w-full max-w-3xl">
          <SearchScanning />
        </div>
      ) : contentView === "results" && search.result !== null ? (
        <div
          className={cn(
            "flex w-full flex-col gap-2",
            activeView === "graph" && search.result.events.length > 0
              ? "mx-auto min-h-0 max-w-[1200px] flex-1"
              : "mx-auto max-w-3xl",
          )}
        >
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              {t("results")}
              <span
                className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground"
              >
                {searchStrategies(
                  getSearchStrategy(search.busy ? search.strategy : search.lastStrategy).labelKey,
                )}
              </span>
            </h2>
            <div className="flex items-center gap-3">
              {!compact && <span className="text-xs text-muted-foreground">
                {resultStatus}
              </span>}
              {showGraphView && (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={view}
                  onValueChange={(v) => v && setView(v as typeof view)}
                  aria-label={t("resultViewAria")}
                >
                  <ToggleGroupItem value="list" aria-label={t("listView")}>
                    <List />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="graph" aria-label={t("graphView")}>
                    <Waypoints />
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
          </div>
          {(search.summaryStreaming || search.result.summary) && (
            <SearchSummaryCard
              summary={search.result.summary}
              citations={citations}
              compact={compact}
              streaming={search.summaryStreaming}
              onCitationClick={(citation) => {
                if (onCitationClick) {
                  onCitationClick(citation, search.result!);
                  return;
                }
                if (!citation.chunk_id || !citation.source_id) return;
                open({
                  kind: "chunk",
                  sourceId: citation.source_id,
                  chunkId: citation.chunk_id,
                  heading: citation.heading,
                  sourceName: citation.source_name ?? undefined,
                });
              }}
            />
          )}
          {search.error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive"
            >
              <span className="min-w-0">{t("loadMoreFailed", { error: search.error })}</span>
              {search.canLoadMore && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="shrink-0 rounded-md border border-destructive/25 px-2 py-1 font-medium outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("retry")}
                </button>
              )}
            </div>
          )}
          {activeView === "graph" && search.result.events.length > 0 ? (
            <div className="min-h-0 flex-1">
              <SearchGraph
                events={search.result.events}
                entities={search.result.entities}
                relations={search.result.relations}
                onOpenEvent={
                  onEventClick
                    ? (event) => onEventClick(event, search.result!)
                    : undefined
                }
              />
            </div>
          ) : (
            <>
              <ResultList
                result={search.result}
                onEventClick={onEventClick}
                onCitationClick={onCitationClick}
                compact={compact}
              />
              {((search.canLoadMore && !search.error) || (search.busy && search.hasMore)) && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={!search.canLoadMore}
                    className="rounded-full border bg-card px-4 py-1.5 text-xs text-muted-foreground shadow-soft outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {search.busy ? t("loading") : t("showMoreResults")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : contentView === "results" && search.error ? (
        <div className="mx-auto w-full max-w-3xl">
          <EmptyState
            icon={SearchIcon}
            title={t("incomplete")}
            description={search.error}
            action={(
              <button
                type="button"
                onClick={() => void run()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("searchAgain")}
              </button>
            )}
          />
        </div>
      ) : contentView === "history" ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <SearchHistoryList
            queries={search.history}
            compact={compact}
            onSelect={(query) => {
              search.setQuery(query);
              void executeSearch({ query, saveExploration: false });
            }}
            onRemove={search.removeHistory}
            onClear={search.clearHistory}
          />
        </div>
      ) : contentView === "activity" && showRecentActivity ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <ActivityTimeline
            items={search.activity}
            compact={compact}
            interactive={activityInteractive}
            onItemOpen={onActivityClick}
          />
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-6 text-center">
          <div>
            <SearchIcon className="mx-auto size-6 text-muted-foreground/55" />
            <p className="mt-2 text-sm font-medium">{t("startTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("startDescription")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
