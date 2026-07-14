"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Focus,
  GitBranch,
  Info,
  Loader2,
  LockKeyhole,
  LocateFixed,
  MessageCircleQuestion,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import type {
  UniverseActivation,
  UniverseActivationOrigin,
  UniverseGraphPatch,
  UniverseManifest,
  UniverseNodeKind,
  UniverseTimelineDirection,
} from "@/lib/types";
import {
  UNIVERSE_ACTIVATE_EVENT,
  UNIVERSE_FOCUS_EVENT,
  UNIVERSE_RESET_EVENT,
  UNIVERSE_SOURCE_FOCUS_EVENT,
  dispatchUniverseAsk,
  dispatchUniverseDetail,
  dispatchUniversePatch,
  dispatchUniversePatchReset,
  dispatchUniverseView,
} from "@/lib/universe-events";
import {
  UNIVERSE_RESIDENT_BUDGET,
  UNIVERSE_SCENE_BUDGET,
  emptyUniverseWorkingSet,
  replaceUniverseWorkingSet,
  trimUniverseWorkingSet,
  universeAnchorProgress,
  universeNodeKey,
  universeRelationKey,
  type UniverseWorkingSet,
} from "@/lib/universe-working-set";
import {
  advanceUniverseTimelineWindow,
  createUniverseTimelineWindow,
  markUniverseTimelineNetworkExhausted,
  projectUniverseBundleWindowWithinBudget,
  queriedUniverseTimelineEventCount,
  reconfigureUniverseTimelineWindow,
  retainUniverseWorkingSetBundles,
  settleUniverseTimelineWindow,
  universeTimelinePageBundleLimit,
  universeTimelineRewindStartActiveIndex,
  type UniverseTimelineWindowState,
} from "@/lib/universe-timeline-window";
import { admitUniverseExpansionPage } from "@/lib/universe-expansion-admission";
import { admitUniverseTimelinePage } from "@/lib/universe-timeline-admission";
import {
  admitUniverseTimelineDequePage,
  resizeUniverseTimelineDeque,
  syncUniverseTimelineWindowToDeque,
  type UniverseTimelineDequeAdmission,
  type UniverseTimelineDeque,
} from "@/lib/universe-timeline-deque";
import {
  commitUniverseDisplayIntent,
  createUniverseDisplayModeState,
  planUniverseDisplayTimelineIntent,
  projectUniverseTemporalBatch,
  setUniverseDisplayMode,
  universeTemporalRankProgress,
  type UniverseDisplayIntentPlan,
  type UniverseDisplayModeState,
} from "@/lib/universe-display-mode";
import { planUniverseTimelinePrefetch } from "@/lib/universe-timeline-prefetch";
import { detectUniverseWebGLCapability } from "@/lib/universe-webgl-capability";
import {
  effectiveUniverseBudget,
  effectiveUniverseBundleWindow,
  projectUniverseWorkingSet,
  publishUniverseEntityCategories,
  useUniverseViewPreferences,
} from "@/lib/universe-view-preferences";
import { cn } from "@/lib/utils";
import {
  UniverseScene,
  type UniverseSceneData,
  type UniverseSceneHandle,
  type UniverseSceneLink,
  type UniverseSceneNode,
  type UniverseSceneUnavailableReason,
  type UniverseTimelineIntentResult,
  type UniverseTimelineJourney,
  type UniverseSceneView,
} from "@/components/features/universe-scene";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Universe3DNode extends UniverseSceneNode {
  root: boolean;
}

type UniverseConcrete3DNode = Universe3DNode & { kind: "event" | "entity" };

type Universe3DLink = UniverseSceneLink;

interface ActivationSummary {
  query: string;
  events: number;
  entities: number;
  relations: number;
}

interface Position3D {
  x: number;
  y: number;
  z: number;
}

interface SourceTimelinePageState {
  deque: UniverseTimelineDeque | null;
  snapshotId: string | null;
  sourceRevision: string | null;
  asOf: string | null;
  /** Stable network page size for the lifetime of one source snapshot. */
  queryPageSize: number | null;
  preferredDirection: UniverseTimelineDirection;
  loading: boolean;
  pausedReason: "capacity" | null;
  window: UniverseTimelineWindowState;
}

type SourceTimelineLoadCause = "source-entry" | "prefetch" | "journey";
type SourceTimelineLoadResult = "blocked" | "loaded";

interface SourceBrowseSession {
  sourceId: string;
  working: UniverseWorkingSet;
  timeline: SourceTimelinePageState;
}

interface ExpansionSnapshotContext {
  snapshotId: string;
  sourceRevision: string;
  asOf: string;
}

interface SourceLoadMetric {
  loaded: number;
  total: number;
  done: boolean;
  loading: boolean;
}

interface SourceLoadProgress {
  sourceId: string;
  label: string;
  events: SourceLoadMetric;
  entities: SourceLoadMetric;
  allDone: boolean;
  loading: boolean;
}

const PARTITION_RENDER_LIMIT = { desktop: 160, mobile: 64 } as const;
const EVENT_ENTITY_PROJECTION_LIMIT = 8;
const ENTITY_EXPANSION_EVENT_LIMIT = 4;
const EMPTY_TIMELINE_BUNDLE_IDS: string[] = [];

function emptySourceTimelinePageState(
  visibleEventBundles: number,
  cachedEventBundles: number,
): SourceTimelinePageState {
  return {
    deque: null,
    snapshotId: null,
    sourceRevision: null,
    asOf: null,
    queryPageSize: null,
    preferredDirection: "older",
    loading: false,
    pausedReason: null,
    window: createUniverseTimelineWindow(
      visibleEventBundles,
      cachedEventBundles,
    ),
  };
}

function emptySourceBrowseSession(
  epoch: number,
  sourceId: string,
  visibleEventBundles: number,
  cachedEventBundles: number,
): SourceBrowseSession {
  return {
    sourceId,
    working: emptyUniverseWorkingSet(epoch),
    timeline: emptySourceTimelinePageState(
      visibleEventBundles,
      cachedEventBundles,
    ),
  };
}

function synchronizeTimelineWindowWithDeque(
  current: UniverseTimelineWindowState,
  previousDeque: UniverseTimelineDeque | null,
  admission: UniverseTimelineDequeAdmission,
) {
  const activeBundleId = current.activeIndex >= 0
    ? current.cacheBundleIds[current.activeIndex] ?? null
    : null;
  const anchor = syncUniverseTimelineWindowToDeque(admission.deque, {
    activeBundleId,
    activeIndex: current.activeIndex,
    visibleLimit: current.visibleLimit,
  });
  if (!anchor) return null;

  const initial = previousDeque === null;
  const cacheStartOffset = initial
    ? 0
    : Math.max(
        0,
        current.cacheStartOffset
          + admission.evictedNewerBundleIds.length
          - admission.prependedBundleIds.length,
      );
  const rewindStartOffset = initial
    ? cacheStartOffset + anchor.activeIndex
    : current.rewindStartOffset;
  const networkExhausted = !admission.deque.hasOlder;
  const atOlderEdge = anchor.activeIndex === anchor.cacheBundleIds.length - 1;
  return {
    ...current,
    cacheBundleIds: anchor.cacheBundleIds,
    activeIndex: anchor.activeIndex,
    visibleBundleIds: anchor.visibleBundleIds,
    visitedCount: Math.max(
      current.visitedCount,
      cacheStartOffset + anchor.activeIndex + 1,
    ),
    queriedCount: Math.max(
      current.queriedCount,
      cacheStartOffset + anchor.cacheBundleIds.length,
    ),
    networkExhausted,
    phase: networkExhausted && atOlderEdge ? "complete" as const : current.phase,
    revision: current.revision + 1,
    cacheLimit: Math.max(current.visibleLimit, current.cacheLimit),
    cacheStartOffset,
    rewindStartOffset,
  };
}

function nextUniverseLockedNodeId(
  currentLockedId: string | null,
  clickedId: string,
) {
  return currentLockedId === clickedId ? null : clickedId;
}

function universeExpansionCacheKey(
  epoch: number,
  sourceId: string,
  sourceRevision: string,
  snapshotId: string,
  kind: UniverseNodeKind,
  nodeId: string,
  cursor: string | null,
) {
  return [
    epoch,
    sourceId,
    sourceRevision,
    snapshotId,
    kind,
    nodeId,
    cursor ?? "root",
  ].join(":");
}

function waitForAbortableDelay(duration: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, duration);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function stableOffset(key: string, radius: number): Position3D {
  const azimuth = stableUnit(`${key}:azimuth`) * Math.PI * 2;
  const vertical = stableUnit(`${key}:vertical`) * 2 - 1;
  const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  const distance = radius * (0.46 + stableUnit(`${key}:distance`) * 0.5);
  return {
    x: Math.cos(azimuth) * planar * distance,
    y: Math.sin(azimuth) * planar * distance,
    z: vertical * distance,
  };
}

function stableRootEventOffset(
  sourceId: string,
  key: string,
  radius: number,
  index: number,
  total: number,
): Position3D {
  // Root events define the readable timeline skeleton. A shallow golden-angle
  // spiral keeps their default camera projection separated while retaining a
  // small, deterministic Z variation for 3D depth.
  const count = Math.max(1, total);
  const progress = (index + 0.65) / count;
  const distance = radius * (0.5 + Math.sqrt(progress) * 0.43);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const phase = stableUnit(`${sourceId}:root-event-phase`) * Math.PI * 2;
  const angle = phase + index * goldenAngle;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance * 0.82,
    z: (stableUnit(`${key}:root-event-depth`) - 0.5) * radius * 0.18,
  };
}

function timelineProjectionBundleIds(
  current: UniverseWorkingSet,
  timelineBundleIds: readonly string[],
  visibleTimelineBundleIds: readonly string[],
) {
  const timelineIds = new Set(timelineBundleIds);
  const visibleIds = new Set(visibleTimelineBundleIds);
  const availableNodeKeys = new Set(current.nodes.map((node) =>
    universeNodeKey(node.kind, node.id, node.source_id)));
  const visibleNodeKeys = new Set<string>(
    visibleTimelineBundleIds
      .flatMap((id) => current.bundles[id]?.node_keys ?? [])
      .filter((key) => availableNodeKeys.has(key)),
  );
  const supportIds = lineageQualifiedExpansionBundleIds(
    current,
    visibleNodeKeys,
  );
  return current.bundle_order.filter((id) => {
    if (visibleIds.has(id)) return true;
    if (timelineIds.has(id)) return false;
    return supportIds.has(id);
  });
}

function lineageQualifiedExpansionBundleIds(
  current: UniverseWorkingSet,
  seedNodeKeys: Iterable<string>,
) {
  const roots = new Set(seedNodeKeys);
  const supportIds = new Set<string>();
  current.bundle_order.forEach((id) => {
    const bundle = current.bundles[id];
    if (
      bundle?.origin === "expansion"
      && bundle.lineage_root_key
      && roots.has(bundle.lineage_root_key)
    ) supportIds.add(id);
  });
  return supportIds;
}

function expansionLineageRootKey(
  current: UniverseWorkingSet,
  timelineBundleIds: readonly string[],
  anchorKey: string,
) {
  const timelineNodeKeys = new Set(
    timelineBundleIds.flatMap((id) => current.bundles[id]?.node_keys ?? []),
  );
  if (timelineNodeKeys.has(anchorKey)) return anchorKey;
  for (let index = current.bundle_order.length - 1; index >= 0; index -= 1) {
    const bundle = current.bundles[current.bundle_order[index]];
    if (
      bundle?.origin === "expansion"
      && bundle.node_keys.includes(anchorKey)
      && bundle.lineage_root_key
      && timelineNodeKeys.has(bundle.lineage_root_key)
    ) return bundle.lineage_root_key;
  }
  return null;
}

function timelineRetentionBundleIds(
  current: UniverseWorkingSet,
  timelineBundleIds: readonly string[],
) {
  const timelineIds = new Set(timelineBundleIds);
  const timelineNodeKeys = new Set(
    timelineBundleIds.flatMap((id) => current.bundles[id]?.node_keys ?? []),
  );
  const supportIds = lineageQualifiedExpansionBundleIds(current, timelineNodeKeys);
  const anchoredSupportIds = current.bundle_order.filter((id) =>
    !timelineIds.has(id) && supportIds.has(id));
  // Cached timeline bundles are the virtual list's data backing and must stay
  // resident even while off-screen. Expansion payloads remain eligible only
  // while their stable timeline lineage root is still in that cache.
  return [...new Set([...timelineBundleIds, ...anchoredSupportIds])];
}

function universeBundleWindowProtection(
  current: UniverseWorkingSet,
  bundleIds: readonly string[],
) {
  const nodeKeys = new Set<string>();
  const relationKeys = new Set<string>();
  bundleIds.forEach((id) => {
    const bundle = current.bundles[id];
    bundle?.node_keys.forEach((key) => nodeKeys.add(key));
    bundle?.relation_keys.forEach((key) => relationKeys.add(key));
  });
  return { nodeKeys: [...nodeKeys], relationKeys: [...relationKeys] };
}

function compactCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function universeSceneDataSignature(data: UniverseSceneData) {
  return JSON.stringify({
    epoch: data.epoch,
    windowRevision: data.windowRevision ?? 0,
    windowChangeCause: data.windowChangeCause ?? "synchronization",
    windowDirection: data.windowDirection ?? null,
    nodes: data.nodes,
    links: data.links,
  });
}

function LoadProgressRow({
  label,
  metric,
  tone,
}: {
  label: string;
  metric: SourceLoadMetric;
  tone: "entity" | "event";
}) {
  const locale = useLocale();
  const t = useTranslations("KnowledgeUniverse");
  const total = Math.max(metric.total, metric.loaded);
  const progress = total > 0
    ? Math.min(100, Math.max(0, metric.loaded / total * 100))
    : metric.done ? 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[10px] leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/85">
          {compactCount(metric.loaded, locale)} / {compactCount(total, locale)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]"
        role="progressbar"
        aria-label={t("loadProgress.rowAria", { label })}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(metric.loaded, total)}
        data-loaded={metric.loaded}
        data-total={total}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,filter] duration-500 ease-out",
            tone === "entity"
              ? "bg-cyan-300 shadow-[0_0_10px_rgb(103_232_249_/_0.48)]"
              : "bg-amber-300 shadow-[0_0_10px_rgb(252_211_77_/_0.42)]",
            metric.loading && "brightness-110",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function UniverseLoadProgressPanel({
  progress,
  reducedMotion,
  explicitOnly,
}: {
  progress: SourceLoadProgress;
  reducedMotion: boolean;
  explicitOnly: boolean;
}) {
  const t = useTranslations("KnowledgeUniverse");
  const started = progress.events.loaded > 0 || progress.entities.loaded > 0;
  const status = progress.allDone
    ? t("loadProgress.complete")
    : progress.loading
      ? t("loadProgress.loading")
      : started
        ? explicitOnly ? t("loadProgress.clickContinue") : t("loadProgress.browseContinue")
        : explicitOnly ? t("loadProgress.clickStart") : t("loadProgress.browseStart");
  return (
    <motion.div
      data-universe-load-progress="true"
      data-source-id={progress.sourceId}
      data-load-state={progress.allDone ? "complete" : progress.loading ? "loading" : "idle"}
      role="status"
      aria-live="polite"
      className="pointer-events-none w-[min(15rem,calc(100vw-1.5rem))] rounded-md border border-border/65 bg-background/76 p-3 shadow-soft backdrop-blur-xl sm:w-60"
      initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.985 }}
      transition={{
        duration: reducedMotion ? 0 : 0.22,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-foreground/90" title={progress.label}>
            {t("loadProgress.title")}
          </p>
          <p className="mt-0.5 truncate text-[9px] text-muted-foreground" title={status}>
            {status}
          </p>
        </div>
        {progress.allDone ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
        ) : progress.loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-300" aria-hidden="true" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-foreground/25" aria-hidden="true" />
        )}
      </div>
      <div className="space-y-2.5">
        <LoadProgressRow label={t("loadProgress.events")} metric={progress.events} tone="event" />
        <LoadProgressRow label={t("loadProgress.entities")} metric={progress.entities} tone="entity" />
      </div>
    </motion.div>
  );
}

function isConcreteUniverseNode(
  node: Universe3DNode | null,
): node is UniverseConcrete3DNode {
  return Boolean(node && node.kind !== "source");
}

function visualNebulaRadius(eventCount: number, entityCount: number, sourceCount: number) {
  const total = Math.max(1, eventCount + entityCount * 0.72);
  const dataScale = 54 + Math.min(62, Math.log2(total + 1) * 9.2);
  const crowdScale = Math.min(
    1.04,
    Math.max(0.52, 1.18 - Math.log2(Math.max(2, sourceCount + 1)) * 0.09),
  );
  return Math.max(38, dataScale * crowdScale);
}

function dominantSource(activation: UniverseActivation) {
  if (activation.source_hits?.[0]?.source_id) return activation.source_hits[0].source_id;
  const counts = new Map<string, number>();
  activation.nodes.forEach((node) => {
    if (!node.source_id || node.kind !== "event") return;
    counts.set(node.source_id, (counts.get(node.source_id) ?? 0) + 1);
  });
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function IconControl({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 border-border/70 bg-background/75 text-muted-foreground shadow-soft backdrop-blur-md hover:bg-background hover:text-foreground"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export function KnowledgeUniverse({
  interactive = true,
}: {
  interactive?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("KnowledgeUniverse");
  const reducedMotion = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const darkTheme = resolvedTheme === "dark";
  const containerRef = React.useRef<HTMLDivElement>(null);
  const graphRef = React.useRef<UniverseSceneHandle | null>(null);
  const interactiveRef = React.useRef(interactive);
  interactiveRef.current = interactive;
  const focusTimerRef = React.useRef<number | null>(null);
  const cameraFrameRef = React.useRef<number | null>(null);
  const epochRef = React.useRef(0);
  const workingRef = React.useRef<UniverseWorkingSet>(emptyUniverseWorkingSet());
  const budgetRef = React.useRef<{ nodes: number; edges: number }>(
    UNIVERSE_SCENE_BUDGET.mobile,
  );
  const residentBudgetRef = React.useRef<{ nodes: number; edges: number }>(
    UNIVERSE_RESIDENT_BUDGET.mobile,
  );
  const expandAbortRef = React.useRef<AbortController | null>(null);
  const expansionCacheRef = React.useRef(new Map<string, UniverseGraphPatch>());
  const expansionInflightRef = React.useRef(new Map<string, {
    promise: Promise<UniverseGraphPatch>;
    signal: AbortSignal;
  }>());
  const rebuildAbortRef = React.useRef<AbortController | null>(null);
  const autoRebuildAttemptedRef = React.useRef(false);
  const observedManifestRef = React.useRef(false);
  const manifestVersionRef = React.useRef<string | null>(null);
  const timelineAbortRef = React.useRef<AbortController | null>(null);
  const timelineLoadCauseRef = React.useRef<SourceTimelineLoadCause | null>(null);
  const timelineRequestRef = React.useRef<Promise<SourceTimelineLoadResult> | null>(null);
  const timelinePageLoaderRef = React.useRef<((
    sourceId: string,
    cause: SourceTimelineLoadCause,
    direction?: UniverseTimelineDirection,
  ) => Promise<SourceTimelineLoadResult>) | null>(null);
  const snapshotReloadTimerRef = React.useRef<number | null>(null);
  const snapshotReloadAttemptsRef = React.useRef(new Map<string, number>());
  const timelineSettleTimerRef = React.useRef<number | null>(null);
  const sourceSessionRef = React.useRef<SourceBrowseSession | null>(null);
  const timelineJourneyCommitRef = React.useRef<{
    session: SourceBrowseSession;
    revision: number;
    cause: "journey";
    direction: "next" | "previous";
  } | null>(null);
  const expansionSnapshotsRef = React.useRef(new Map<string, ExpansionSnapshotContext>());
  const completedSourcesRef = React.useRef(new Set<string>());
  const activationOriginRef = React.useRef<UniverseActivationOrigin>("browse");
  const viewportSourceRef = React.useRef<string | null>(null);
  const lockedKeyRef = React.useRef<string | null>(null);
  const cursorsRef = React.useRef(new Map<string, string>());
  const expandedAnchorsRef = React.useRef(new Set<string>());
  const expandingAnchorRef = React.useRef<string | null>(null);
  const nodeByIdRef = React.useRef(new Map<string, Universe3DNode>());
  const graphDataCacheRef = React.useRef<{
    signature: string;
    data: UniverseSceneData;
  } | null>(null);
  const { preferences: viewPreferences } = useUniverseViewPreferences();
  const entityCategorySignature = viewPreferences.entityCategories === null
    ? "null"
    : JSON.stringify([...viewPreferences.entityCategories].sort());
  const projectedEntityCategories = React.useMemo<string[] | null>(
    () => JSON.parse(entityCategorySignature) as string[] | null,
    [entityCategorySignature],
  );
  const [dimensions, setDimensions] = React.useState({ width: 1, height: 1 });
  const [manifest, setManifest] = React.useState<UniverseManifest | null>(null);
  const [working, setWorking] = React.useState<UniverseWorkingSet>(emptyUniverseWorkingSet());
  const [timelineWindow, setTimelineWindow] =
    React.useState<UniverseTimelineWindowState | null>(null);
  const [displayModeState, setDisplayModeState] =
    React.useState<UniverseDisplayModeState>(() => createUniverseDisplayModeState());
  const displayModeRef = React.useRef(displayModeState);
  displayModeRef.current = displayModeState;
  const [activePartition, setActivePartition] = React.useState<string | null>(null);
  const [viewportSourceId, setViewportSourceId] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKeyState] = React.useState<string | null>(null);
  const [lockedKey, setLockedKeyState] = React.useState<string | null>(null);
  const [sourceHits, setSourceHits] = React.useState<
    NonNullable<UniverseActivation["source_hits"]>
  >([]);
  const [summary, setSummary] = React.useState<ActivationSummary | null>(null);
  const [expandingKey, setExpandingKey] = React.useState<string | null>(null);
  const [moreHint, setMoreHint] = React.useState("");
  const [activationOrigin, setActivationOrigin] =
    React.useState<UniverseActivationOrigin>("browse");
  const [, setLoadProgressRevision] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [error, setError] = React.useState("");
  const [webglAvailable, setWebglAvailable] = React.useState<boolean | null>(null);
  const [sceneUnavailableReason, setSceneUnavailableReason] =
    React.useState<UniverseSceneUnavailableReason | null>(null);
  const [sceneAttempt, setSceneAttempt] = React.useState(0);
  const sceneRetryFrameRef = React.useRef<number | null>(null);

  // The loaded browse session is the data authority for timeline paging.
  // `activePartition` is intentionally kept as camera/presentation state so
  // visual LOD changes cannot disconnect a valid cached timeline.
  const browseSessionSourceId = activationOrigin === "browse" && timelineWindow
    ? sourceSessionRef.current?.sourceId ?? null
    : null;

  const setSelectedKey = React.useCallback((key: string | null) => {
    setSelectedKeyState(key);
  }, []);

  const updateDisplayMode = React.useCallback((
    update: (current: UniverseDisplayModeState) => UniverseDisplayModeState,
  ) => {
    setDisplayModeState((current) => {
      const next = update(current);
      displayModeRef.current = next;
      return next;
    });
  }, []);

  const restoreNormalPresentation = React.useCallback(() => {
    if (displayModeRef.current.mode === "normal") return;
    setMoreHint(t("controls.cameraRestored"));
    updateDisplayMode((current) => current.mode === "normal"
      ? current
      : setUniverseDisplayMode(
          current,
          "normal",
          sourceSessionRef.current?.timeline.window.revision ?? 0,
        ));
  }, [t, updateDisplayMode]);

  const setLockedKey = React.useCallback((key: string | null) => {
    lockedKeyRef.current = key;
    setLockedKeyState(key);
  }, []);

  const commitWorkingSet = React.useCallback((next: UniverseWorkingSet) => {
    workingRef.current = next;
    const session = sourceSessionRef.current;
    if (session && session.working.epoch === next.epoch) {
      session.working = next;
    }
    setWorking(next);
  }, []);

  const commitTimelineWindow = React.useCallback((
    session: SourceBrowseSession,
    next: UniverseTimelineWindowState,
  ) => {
    if (sourceSessionRef.current !== session) return;
    session.timeline.window = next;
    setTimelineWindow(next);
  }, []);

  const scheduleTimelineSettle = React.useCallback((
    session: SourceBrowseSession,
    next: UniverseTimelineWindowState,
  ) => {
    if (timelineSettleTimerRef.current !== null) {
      window.clearTimeout(timelineSettleTimerRef.current);
    }
    if (next.phase !== "transitioning") {
      timelineSettleTimerRef.current = null;
      return;
    }
    timelineSettleTimerRef.current = window.setTimeout(() => {
      timelineSettleTimerRef.current = null;
      if (
        sourceSessionRef.current !== session
        || session.timeline.window.revision !== next.revision
      ) return;
      commitTimelineWindow(session, settleUniverseTimelineWindow(next));
    }, reducedMotion ? 0 : 520);
  }, [commitTimelineWindow, reducedMotion]);

  const clearTimelineSettle = React.useCallback(() => {
    if (timelineSettleTimerRef.current !== null) {
      window.clearTimeout(timelineSettleTimerRef.current);
      timelineSettleTimerRef.current = null;
    }
  }, []);

  const mobile = dimensions.width < 768;
  const configuredBundleWindow = React.useMemo(
    () => effectiveUniverseBundleWindow(viewPreferences, mobile),
    [mobile, viewPreferences],
  );
  const policyBudget = React.useMemo(() => {
    const hardLimit = mobile
      ? UNIVERSE_SCENE_BUDGET.mobile
      : UNIVERSE_SCENE_BUDGET.desktop;
    if (!manifest) return hardLimit;
    return {
      nodes: Math.min(
        hardLimit.nodes,
        mobile
          ? manifest.policy.node_budget_mobile
          : manifest.policy.node_budget_desktop,
      ),
      edges: Math.min(
        hardLimit.edges,
        mobile
          ? manifest.policy.edge_budget_mobile
          : manifest.policy.edge_budget_desktop,
      ),
    };
  }, [manifest, mobile]);
  const budget = React.useMemo(
    () => effectiveUniverseBudget(policyBudget),
    [policyBudget],
  );
  const timelineBundleEntityLimit = Math.max(0, Math.min(
    EVENT_ENTITY_PROJECTION_LIMIT,
    manifest?.policy.event_entity_limit ?? EVENT_ENTITY_PROJECTION_LIMIT,
  ));
  const timelineWindowPlan = React.useMemo(() => {
    const nodesPerPackage = Math.max(1, timelineBundleEntityLimit + 1);
    const edgesPerPackage = timelineBundleEntityLimit;
    const nodeCapacity = Math.max(0, Math.floor(budget.nodes / nodesPerPackage));
    const edgeCapacity = edgesPerPackage > 0
      ? Math.max(0, Math.floor(budget.edges / edgesPerPackage))
      : nodeCapacity;
    const packageCapacity = Math.min(nodeCapacity, edgeCapacity);
    let visibleEventBundles = Math.max(
      1,
      Math.min(configuredBundleWindow.visibleEventBundles, packageCapacity || 1),
    );
    const requiredTransitionPackages = (visible: number) => Math.max(
      1,
      Math.min(ENTITY_EXPANSION_EVENT_LIMIT, Math.max(0, visible - 1)),
    );
    while (
      visibleEventBundles > 1
      && visibleEventBundles + requiredTransitionPackages(visibleEventBundles)
        > packageCapacity
    ) visibleEventBundles -= 1;
    const transitionHeadroomPackages = Math.max(0, Math.min(
      requiredTransitionPackages(visibleEventBundles),
      packageCapacity - visibleEventBundles,
    ));
    return {
      window: {
        visibleEventBundles,
        cachedEventBundles: configuredBundleWindow.cachedEventBundles,
      },
      projectionBudget: {
        nodes: Math.max(
          0,
          budget.nodes - transitionHeadroomPackages * nodesPerPackage,
        ),
        edges: Math.max(
          0,
          budget.edges - transitionHeadroomPackages * edgesPerPackage,
        ),
      },
      transitionHeadroomPackages,
    };
  }, [
    budget,
    configuredBundleWindow,
    timelineBundleEntityLimit,
  ]);
  const bundleWindow = timelineWindowPlan.window;
  const timelineProjectionBudget = timelineWindowPlan.projectionBudget;
  const residentBudget = mobile
    ? UNIVERSE_RESIDENT_BUDGET.mobile
    : UNIVERSE_RESIDENT_BUDGET.desktop;
  const timelineCacheBundleIds = timelineWindow?.cacheBundleIds
    ?? EMPTY_TIMELINE_BUNDLE_IDS;
  const timelineVisibleBundleIds = timelineWindow?.visibleBundleIds
    ?? EMPTY_TIMELINE_BUNDLE_IDS;
  const timelineWindowRevision = timelineWindow?.revision ?? -1;
  budgetRef.current = budget;
  residentBudgetRef.current = residentBudget;

  const refreshLoadProgress = React.useCallback(() => {
    setLoadProgressRevision((current) => current + 1);
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const bounds = container.getBoundingClientRect();
      setDimensions({
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    // Do not allocate a disposable probe context here. Chrome has a small
    // per-process context pool, so a probe can fail transiently or compete with
    // the real Three renderer and incorrectly look like permanent lack of WebGL.
    const capability = detectUniverseWebGLCapability(window);
    setWebglAvailable(capability === "available");
  }, [sceneAttempt]);

  React.useEffect(() => () => {
    if (sceneRetryFrameRef.current !== null) {
      window.cancelAnimationFrame(sceneRetryFrameRef.current);
    }
  }, []);

  const loadManifest = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setManifest(await api.universeManifest());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("errors.unavailable"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (!interactive) return;
    void loadManifest();
  }, [interactive, loadManifest]);

  React.useEffect(() => {
    if (!interactive || manifest?.status !== "building") return;
    let alive = true;
    const timer = window.setInterval(() => {
      void api.universeManifest().then((next) => {
        if (alive) setManifest(next);
      }).catch(() => undefined);
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [interactive, manifest?.status]);

  const sourcePartitions = React.useMemo(
    () => manifest?.partitions.filter((partition) => partition.kind === "source") ?? [],
    [manifest],
  );
  const sourceById = React.useMemo(
    () => new Map(sourcePartitions.map((partition) => [partition.source_id, partition])),
    [sourcePartitions],
  );
  const viewportSource = viewportSourceId
    ? sourceById.get(viewportSourceId) ?? null
    : null;
  const viewportLoadProgress: SourceLoadProgress | null = (() => {
    if (!viewportSource) return null;
    const session = sourceSessionRef.current?.sourceId === viewportSource.source_id
      ? sourceSessionRef.current
      : null;
    const eventState = session?.timeline;
    const entityTotal = Math.max(0, viewportSource.entity_count);
    const eventTotal = Math.max(0, viewportSource.event_count);
    const residentNodes = working.nodes.filter(
      (node) => node.source_id === viewportSource.source_id,
    );
    // Entity progress is deliberately resident, not an all-time unique count:
    // the working set is bounded while a source may contain arbitrarily many
    // identities across its full timeline.
    const entityLoaded = Math.min(
      entityTotal,
      residentNodes.filter((node) => node.kind === "entity").length,
    );
    const eventLoaded = Math.min(eventTotal, eventState
      ? queriedUniverseTimelineEventCount(eventState.window)
      : residentNodes.filter((node) => node.kind === "event").length);
    const timelineComplete = eventState?.window.phase === "complete";
    const entities = {
      loaded: entityLoaded,
      total: entityTotal,
      done: eventState
        ? timelineComplete
        : entityTotal === 0 || entityLoaded >= entityTotal,
      loading: Boolean(eventState?.loading),
    };
    const events = {
      loaded: eventLoaded,
      total: eventTotal,
      done: eventState
        ? timelineComplete
        : eventTotal === 0 || eventLoaded >= eventTotal,
      loading: Boolean(eventState?.loading),
    };
    return {
      sourceId: viewportSource.source_id,
      label: viewportSource.label,
      entities,
      events,
      allDone: entities.done && events.done,
      loading: entities.loading || events.loading,
    };
  })();
  const renderedSourcePartitions = React.useMemo(() => {
    const limit = mobile
      ? PARTITION_RENDER_LIMIT.mobile
      : PARTITION_RENDER_LIMIT.desktop;
    const ranked = [...sourcePartitions].sort(
      (left, right) => right.importance - left.importance || left.id.localeCompare(right.id),
    );
    const relevantSourceIds = activationOrigin === "search"
      ? new Set([
          ...sourceHits.map((hit) => hit.source_id),
          ...working.nodes.map((node) => node.source_id).filter(Boolean),
        ])
      : null;
    const candidates = relevantSourceIds?.size
      ? ranked.filter((partition) => relevantSourceIds.has(partition.source_id))
      : ranked;
    const rendered = candidates.slice(0, limit);
    const retainedSourceId = browseSessionSourceId ?? activePartition;
    if (retainedSourceId && !rendered.some((item) => item.source_id === retainedSourceId)) {
      const active = sourceById.get(retainedSourceId);
      if (active) {
        if (rendered.length >= limit) rendered.pop();
        rendered.push(active);
      }
    }
    return rendered;
  }, [
    activationOrigin,
    activePartition,
    browseSessionSourceId,
    mobile,
    sourceById,
    sourceHits,
    sourcePartitions,
    working.nodes,
  ]);

  const focusOverview = React.useCallback(() => {
    graphRef.current?.unlockNode();
    setLockedKey(null);
    setSelectedKey(null);
    graphRef.current?.focusOverview();
  }, [setLockedKey, setSelectedKey]);

  const focusResult = React.useCallback(() => {
    graphRef.current?.focusResult();
  }, []);

  const focusPartition = React.useCallback(
    (sourceId: string) => {
      if (!sourceById.has(sourceId)) return;
      setActivePartition(sourceId);
      graphRef.current?.focusSource(sourceId);
    },
    [sourceById],
  );

  const focusNode = React.useCallback((node: Universe3DNode) => {
    graphRef.current?.focusNode(node.id);
  }, []);

  const clearCameraSchedule = React.useCallback(() => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    if (cameraFrameRef.current !== null) window.cancelAnimationFrame(cameraFrameRef.current);
    focusTimerRef.current = null;
    cameraFrameRef.current = null;
  }, []);

  const pruneExpansionState = React.useCallback((current: UniverseWorkingSet) => {
    const kept = new Map(
      current.nodes.map((node) => [
        universeNodeKey(node.kind, node.id, node.source_id),
        node,
      ]),
    );
    const invalidatedAnchors = new Set<string>();
    for (const key of cursorsRef.current.keys()) {
      if (!kept.has(key)) {
        cursorsRef.current.delete(key);
        invalidatedAnchors.add(key);
      }
    }
    for (const key of expandedAnchorsRef.current) {
      if (!kept.has(key)) {
        expandedAnchorsRef.current.delete(key);
        invalidatedAnchors.add(key);
      }
    }
    if (
      expandingAnchorRef.current
      && invalidatedAnchors.has(expandingAnchorRef.current)
    ) expandAbortRef.current?.abort();
  }, []);

  React.useEffect(() => {
    const current = workingRef.current;
    const session = sourceSessionRef.current;
    if (session) {
      if (session.timeline.pausedReason === "capacity") {
        session.timeline.pausedReason = null;
        setMoreHint("");
        refreshLoadProgress();
      }
      // Timeline cache eviction is bundle-atomic. Let page admission and the
      // timeline-window reconfiguration path converge under the new budget;
      // generic node trimming would desynchronise bundle ownership from cache.
      return;
    }
    let next = trimUniverseWorkingSet(
      current,
      budget,
      lockedKey ? [lockedKey] : [],
    );
    if (
      next.nodes.length > budget.nodes
      || next.relations.length > budget.edges
    ) {
      graphRef.current?.unlockNode();
      setLockedKey(null);
      setSelectedKey(null);
      next = trimUniverseWorkingSet(
        current,
        budget,
      );
      setMoreHint(t("timeline.lockReleasedForCapacity"));
    }
    const unchanged = next.nodes.length === current.nodes.length
      && next.relations.length === current.relations.length
      && next.node_order.every((key, index) => key === current.node_order[index]);
    if (unchanged) return;
    commitWorkingSet(next);
    pruneExpansionState(next);
  }, [
    budget,
    commitWorkingSet,
    lockedKey,
    pruneExpansionState,
    refreshLoadProgress,
    setLockedKey,
    setSelectedKey,
    t,
  ]);

  const resetScene = React.useCallback(
    (epoch: number) => {
      if (epoch < epochRef.current) return;
      epochRef.current = epoch;
      expandAbortRef.current?.abort();
      expandAbortRef.current = null;
      expandingAnchorRef.current = null;
      timelineAbortRef.current?.abort();
      timelineAbortRef.current = null;
      timelineLoadCauseRef.current = null;
      timelineRequestRef.current = null;
      if (snapshotReloadTimerRef.current !== null) {
        window.clearTimeout(snapshotReloadTimerRef.current);
        snapshotReloadTimerRef.current = null;
      }
      snapshotReloadAttemptsRef.current.clear();
      clearTimelineSettle();
      sourceSessionRef.current = null;
      setTimelineWindow(null);
      updateDisplayMode(() => createUniverseDisplayModeState());
      expansionSnapshotsRef.current.clear();
      completedSourcesRef.current.clear();
      refreshLoadProgress();
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      dispatchUniversePatchReset();
      graphRef.current?.unlockNode();
      clearCameraSchedule();
      cursorsRef.current.clear();
      expandedAnchorsRef.current.clear();
      const empty = emptyUniverseWorkingSet(epoch);
      commitWorkingSet(empty);
      setSummary(null);
      activationOriginRef.current = "browse";
      setActivationOrigin("browse");
      setLockedKey(null);
      setSelectedKey(null);
      setSourceHits([]);
      setActivePartition(null);
      setExpandingKey(null);
      setMoreHint("");
      if (interactiveRef.current) {
        const resetEpoch = epoch;
        cameraFrameRef.current = window.requestAnimationFrame(() => {
          cameraFrameRef.current = null;
          if (epochRef.current === resetEpoch) focusOverview();
        });
      }
    },
    [
      clearCameraSchedule,
      clearTimelineSettle,
      commitWorkingSet,
      focusOverview,
      refreshLoadProgress,
      setLockedKey,
      setSelectedKey,
      updateDisplayMode,
    ],
  );

  React.useEffect(() => {
    if (!manifest) return;
    if (!observedManifestRef.current) {
      observedManifestRef.current = true;
      manifestVersionRef.current = manifest.version;
      return;
    }
    if (manifestVersionRef.current === manifest.version) return;
    manifestVersionRef.current = manifest.version;
    if (workingRef.current.nodes.length > 0 || sourceSessionRef.current) {
      resetScene(epochRef.current + 1);
    }
  }, [manifest, resetScene]);

  const invalidateSourceSnapshot = React.useCallback((sourceId: string, epoch: number) => {
    if (epoch !== epochRef.current) return;
    const currentSession = sourceSessionRef.current;
    if (currentSession && currentSession.sourceId !== sourceId) return;
    expandAbortRef.current?.abort();
    expandAbortRef.current = null;
    expandingAnchorRef.current = null;
    timelineAbortRef.current?.abort();
    timelineAbortRef.current = null;
    timelineLoadCauseRef.current = null;
    timelineRequestRef.current = null;
    clearTimelineSettle();
    expansionCacheRef.current.clear();
    expansionInflightRef.current.clear();
    dispatchUniversePatchReset();
    expansionSnapshotsRef.current.clear();
    cursorsRef.current.clear();
    expandedAnchorsRef.current.clear();
    completedSourcesRef.current.delete(sourceId);
    graphRef.current?.unlockNode();
    setLockedKey(null);
    setSelectedKey(null);
    setExpandingKey(null);
    const refreshedSession = emptySourceBrowseSession(
      epoch,
      sourceId,
      bundleWindow.visibleEventBundles,
      bundleWindow.cachedEventBundles,
    );
    sourceSessionRef.current = refreshedSession;
    updateDisplayMode(() => createUniverseDisplayModeState());
    commitWorkingSet(refreshedSession.working);
    setTimelineWindow(refreshedSession.timeline.window);
    refreshLoadProgress();
    setSummary({
      query: sourceById.get(sourceId)?.label ?? t("timeline.defaultTitle"),
      events: 0,
      entities: 0,
      relations: 0,
    });
    const reloadAttempt = (snapshotReloadAttemptsRef.current.get(sourceId) ?? 0) + 1;
    snapshotReloadAttemptsRef.current.set(sourceId, reloadAttempt);
    if (snapshotReloadTimerRef.current !== null) {
      window.clearTimeout(snapshotReloadTimerRef.current);
      snapshotReloadTimerRef.current = null;
    }
    if (reloadAttempt > 1) {
      setMoreHint(t("timeline.snapshotReset"));
      return;
    }
    setMoreHint(t("timeline.snapshotReloading"));
    snapshotReloadTimerRef.current = window.setTimeout(() => {
      snapshotReloadTimerRef.current = null;
      if (
        !interactiveRef.current
        || epochRef.current !== epoch
        || sourceSessionRef.current !== refreshedSession
      ) return;
      const loader = timelinePageLoaderRef.current;
      if (!loader) {
        setMoreHint(t("timeline.snapshotReset"));
        return;
      }
      void loader(sourceId, "source-entry").then((result) => {
        if (
          result === "loaded"
          && sourceSessionRef.current === refreshedSession
        ) {
          snapshotReloadAttemptsRef.current.delete(sourceId);
        }
      });
    }, 0);
  }, [bundleWindow, clearTimelineSettle, commitWorkingSet, refreshLoadProgress, setLockedKey, setSelectedKey, sourceById, t, updateDisplayMode]);

  React.useEffect(() => {
    const onActivate = (event: Event) => {
      const activation = (event as CustomEvent<UniverseActivation>).detail;
      const epoch = activation?.epoch ?? epochRef.current + 1;
      if (!activation || epoch < epochRef.current) return;
      epochRef.current = epoch;
      expandAbortRef.current?.abort();
      expandAbortRef.current = null;
      expandingAnchorRef.current = null;
      timelineAbortRef.current?.abort();
      timelineLoadCauseRef.current = null;
      timelineRequestRef.current = null;
      if (snapshotReloadTimerRef.current !== null) {
        window.clearTimeout(snapshotReloadTimerRef.current);
        snapshotReloadTimerRef.current = null;
      }
      snapshotReloadAttemptsRef.current.clear();
      clearTimelineSettle();
      sourceSessionRef.current = null;
      setTimelineWindow(null);
      expansionSnapshotsRef.current.clear();
      completedSourcesRef.current.clear();
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      dispatchUniversePatchReset();
      graphRef.current?.unlockNode();
      clearCameraSchedule();
      cursorsRef.current.clear();
      expandedAnchorsRef.current.clear();
      const next = replaceUniverseWorkingSet({ ...activation, epoch }, budget);
      commitWorkingSet(next);
      setLockedKey(null);
      setSelectedKey(null);
      setSourceHits(activation.source_hits ?? []);
      const origin = activation.origin ?? "assistant";
      activationOriginRef.current = origin;
      setActivationOrigin(origin);
      setMoreHint("");
      setSummary({
        query: activation.query,
        events: new Set(
          next.nodes.filter((node) => node.kind === "event").map((node) => node.id),
        ).size,
        entities: new Set(
          next.nodes.filter((node) => node.kind === "entity").map((node) => node.id),
        ).size,
        relations: next.relations.length,
      });
      const sourceId = dominantSource(activation);
      setActivePartition(sourceId);
      if (sourceId && !(activation.source_hits?.length) && interactiveRef.current) {
        const activationEpoch = epoch;
        focusTimerRef.current = window.setTimeout(() => {
          focusTimerRef.current = null;
          if (epochRef.current === activationEpoch) focusPartition(sourceId);
        }, reducedMotion ? 0 : 80);
      }
    };
    const onReset = (event: Event) => {
      const value = (event as CustomEvent<{ epoch: number }>).detail;
      resetScene(value?.epoch ?? epochRef.current + 1);
    };
    const onFocus = (event: Event) => {
      const value = (
        event as CustomEvent<{ kind: UniverseNodeKind; id: string; source_id: string }>
      ).detail;
      if (!value) return;
      clearCameraSchedule();
      const exactKey = universeNodeKey(value.kind, value.id, value.source_id);
      const node = nodeByIdRef.current.get(exactKey);
      if (!node) return;
      graphRef.current?.unlockNode();
      setLockedKey(null);
      setSelectedKey(node.id);
      if (interactiveRef.current) focusNode(node);
    };
    window.addEventListener(UNIVERSE_ACTIVATE_EVENT, onActivate);
    window.addEventListener(UNIVERSE_RESET_EVENT, onReset);
    window.addEventListener(UNIVERSE_FOCUS_EVENT, onFocus);
    return () => {
      window.removeEventListener(UNIVERSE_ACTIVATE_EVENT, onActivate);
      window.removeEventListener(UNIVERSE_RESET_EVENT, onReset);
      window.removeEventListener(UNIVERSE_FOCUS_EVENT, onFocus);
    };
  }, [
    budget,
    clearCameraSchedule,
    clearTimelineSettle,
    commitWorkingSet,
    focusNode,
    focusPartition,
    reducedMotion,
    resetScene,
    setLockedKey,
    setSelectedKey,
  ]);

  const graphData = React.useMemo(() => {
    const visualRadiusBySource = new Map(
      renderedSourcePartitions.map((partition) => [
        partition.source_id,
        visualNebulaRadius(
          partition.event_count,
          partition.entity_count,
          renderedSourcePartitions.length,
        ),
      ]),
    );
    const nodes: Universe3DNode[] = renderedSourcePartitions.map((partition) => ({
      id: `partition:${partition.source_id}`,
      kind: "source",
      rawId: partition.id,
      sourceId: partition.source_id,
      label: partition.label,
      description: "",
      category: t("nodeKinds.source"),
      radius: visualRadiusBySource.get(partition.source_id) ?? partition.radius,
      density: partition.density,
      eventCount: partition.event_count,
      entityCount: partition.entity_count,
      relationCount: partition.relation_count,
      relatedCount: partition.relation_count,
      relatedCountKnown: true,
      importance: partition.importance,
      statsReady: Boolean(manifest?.version),
      state: "active",
      root: true,
      x: partition.x,
      y: partition.y,
      z: partition.z,
    }));
    const links: Universe3DLink[] = [];

    const visibleTimelineBundleIds = timelineVisibleBundleIds;
    const categoryProjectedWorking = projectUniverseWorkingSet(
      working,
      projectedEntityCategories,
    );
    const timelineProjectionIds = timelineProjectionBundleIds(
      categoryProjectedWorking,
      timelineCacheBundleIds,
      visibleTimelineBundleIds,
    );
    const visibleTimelineSet = new Set(visibleTimelineBundleIds);
    const timelineSupportBundleIds = timelineProjectionIds.filter((id) =>
      !visibleTimelineSet.has(id)).reverse();
    const projectedWorking = browseSessionSourceId
      && timelineProjectionIds.length > 0
      ? projectUniverseBundleWindowWithinBudget(
          categoryProjectedWorking,
          visibleTimelineBundleIds,
          timelineSupportBundleIds,
          timelineProjectionBudget,
          bundleWindow.visibleEventBundles,
          timelineBundleEntityLimit,
        )
      : categoryProjectedWorking;
    const relationsByEvent = new Map<string, UniverseWorkingSet["relations"]>();
    const relationsByEntity = new Map<string, UniverseWorkingSet["relations"]>();
    const relationSourceByEvent = new Map<string, string>();
    const relationSourceByEntity = new Map<string, string>();
    projectedWorking.relations.forEach((relation) => {
      const eventKey = universeNodeKey("event", relation.from_id, relation.source_id);
      const eventRelations = relationsByEvent.get(eventKey) ?? [];
      eventRelations.push(relation);
      relationsByEvent.set(eventKey, eventRelations);
      relationSourceByEvent.set(relation.from_id, relation.source_id);
      if (relation.kind === "mentions") {
        const entityKey = universeNodeKey("entity", relation.to_id, relation.source_id);
        const entityRelations = relationsByEntity.get(entityKey) ?? [];
        entityRelations.push(relation);
        relationsByEntity.set(entityKey, entityRelations);
        relationSourceByEntity.set(relation.to_id, relation.source_id);
      }
    });
    const workingNodeByKey = new Map(
      projectedWorking.nodes.map((node) => [
        universeNodeKey(node.kind, node.id, node.source_id),
        node,
      ]),
    );
    const visibleNodes = projectedWorking.nodes.map((node) => workingNodeByKey.get(
      universeNodeKey(node.kind, node.id, node.source_id),
    ) ?? node);
    const timelineEventPlacementByKey = new Map<string, {
      bundleId: string;
      index: number;
      total: number;
    }>();
    const timelineBrowseActive = Boolean(browseSessionSourceId);
    const projectedBundleIds = new Set(projectedWorking.bundle_order);
    const temporalProjectionByBundleId = new Map(
      projectUniverseTemporalBatch(
        visibleTimelineBundleIds.map((bundleId, index) => ({
          bundleId,
          ageProgress: universeTemporalRankProgress(
            visibleTimelineBundleIds.length - index - 1,
            visibleTimelineBundleIds.length,
          ),
        })),
        {
          mode: displayModeState.mode,
          direction: displayModeState.preview?.direction,
        },
      ).map((projection) => [projection.bundleId, projection]),
    );
    const temporalBundleByEventKey = new Map<string, string>();
    visibleTimelineBundleIds.forEach((bundleId) => {
      working.bundles[bundleId]?.node_keys.forEach((key) => {
        if (workingNodeByKey.get(key)?.kind === "event") {
          temporalBundleByEventKey.set(key, bundleId);
        }
      });
    });
    const temporalBundleByEntityKey = new Map<string, string>();
    projectedWorking.relations.forEach((relation) => {
      if (relation.kind !== "mentions") return;
      const eventBundleId = temporalBundleByEventKey.get(
        universeNodeKey("event", relation.from_id, relation.source_id),
      );
      if (!eventBundleId) return;
      const entityKey = universeNodeKey("entity", relation.to_id, relation.source_id);
      const currentBundleId = temporalBundleByEntityKey.get(entityKey);
      const currentAge = currentBundleId
        ? temporalProjectionByBundleId.get(currentBundleId)?.ageProgress
        : Number.POSITIVE_INFINITY;
      const candidateAge = temporalProjectionByBundleId.get(eventBundleId)?.ageProgress
        ?? Number.POSITIVE_INFINITY;
      if (candidateAge < (currentAge ?? Number.POSITIVE_INFINITY)) {
        temporalBundleByEntityKey.set(entityKey, eventBundleId);
      }
    });
    const visibleTimelineNodeKeys = new Set(
      visibleTimelineBundleIds
        .filter((bundleId) => projectedBundleIds.has(bundleId))
        .flatMap((bundleId) => working.bundles[bundleId]?.node_keys ?? []),
    );
    const placementBundleByEvent = new Map<string, string>();
    const appendPlacement = (eventKey: string, bundleId: string) => {
      if (workingNodeByKey.get(eventKey)?.kind !== "event") return;
      // A recent explicit support owner promotes the same canonical event to
      // the current exploration focus without creating a second scene node.
      placementBundleByEvent.delete(eventKey);
      placementBundleByEvent.set(eventKey, bundleId);
    };
    visibleTimelineBundleIds.forEach((bundleId) => {
      if (!projectedBundleIds.has(bundleId)) return;
      working.bundles[bundleId]?.node_keys.forEach((key) =>
        appendPlacement(key, bundleId));
    });
    projectedWorking.bundle_order.forEach((bundleId) => {
      const bundle = projectedWorking.bundles[bundleId];
      if (bundle?.origin !== "expansion") return;
      bundle.node_keys.forEach((key) => appendPlacement(key, bundleId));
    });
    const placementEntries = [...placementBundleByEvent.entries()];
    placementEntries.forEach(([eventKey, bundleId], index) => {
      timelineEventPlacementByKey.set(eventKey, {
        bundleId,
        index,
        total: placementEntries.length,
      });
    });
    const isVisualRoot = (node: (typeof visibleNodes)[number]) => {
      if (!timelineBrowseActive) return node.root;
      const key = universeNodeKey(node.kind, node.id, node.source_id);
      if (node.kind === "event") return timelineEventPlacementByKey.has(key);
      return visibleTimelineNodeKeys.has(
        key,
      );
    };
    const projectedEventIdentity = visibleNodes
      .filter((node) => node.kind === "event")
      .map((node) => universeNodeKey(node.kind, node.id, node.source_id))
      .sort();
    const sceneWindowRevision = visibleTimelineBundleIds.length > 0
      ? Math.floor(stableUnit(
          [
            "timeline",
            browseSessionSourceId ?? activePartition ?? "none",
            displayModeState.mode,
            String(displayModeState.revision),
            visibleTimelineBundleIds.join("|"),
            projectedEventIdentity.join("|"),
          ].join(":"),
        ) * 0x7fffffff)
      : 0;
    const resolvedSource = (kind: UniverseNodeKind, id: string, sourceId: string) => {
      if (sourceId) return sourceId;
      return (kind === "event"
        ? relationSourceByEvent.get(id)
        : relationSourceByEntity.get(id)) || browseSessionSourceId || activePartition || "";
    };
    const exactByRaw = new Map<string, string>();
    const positionByRaw = new Map<string, Position3D>();

    const addExactNode = (
      node: (typeof visibleNodes)[number],
      anchor?: Position3D,
      rootEventPlacement?: { index: number; total: number },
    ) => {
      const sourceId = resolvedSource(node.kind, node.id, node.source_id);
      const key = universeNodeKey(node.kind, node.id, sourceId);
      const partition = sourceById.get(sourceId);
      const center = anchor ?? {
        x: partition?.x ?? 0,
        y: partition?.y ?? 0,
        z: partition?.z ?? 0,
      };
      const radius = anchor
        ? 34 + stableUnit(`${key}:local-radius`) * 42
        : Math.max(72, (visualRadiusBySource.get(sourceId) ?? 72) * 1.02);
      const timelinePlacement = timelineEventPlacementByKey.get(key);
      const temporalBundleId = node.kind === "event"
        ? temporalBundleByEventKey.get(key)
        : temporalBundleByEntityKey.get(key);
      const temporalProjection = temporalBundleId
        ? temporalProjectionByBundleId.get(temporalBundleId)
        : undefined;
      const offset = timelinePlacement
        ? displayModeState.mode === "preview" && temporalProjection
          ? {
              x: temporalProjection.normalizedOffset.x * radius * 1.8,
              y: temporalProjection.normalizedOffset.y * radius * 1.8,
              z: temporalProjection.normalizedOffset.z * radius,
            }
          : stableRootEventOffset(
              sourceId,
              key,
              radius,
              timelinePlacement.index,
              timelinePlacement.total,
            )
        : rootEventPlacement
          ? stableRootEventOffset(
            sourceId,
            key,
            radius,
            rootEventPlacement.index,
            rootEventPlacement.total,
          )
          : stableOffset(key, radius);
      const position = {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      };
      nodes.push({
        id: key,
        kind: node.kind,
        rawId: node.id,
        sourceId,
        label: node.label,
        description: node.description ?? "",
        category: node.category ?? t(`nodeKinds.${node.kind}`),
        radius: 0,
        density: 0,
        eventCount: 0,
        entityCount: 0,
        relationCount: 0,
        relatedCount: node.related_count ?? 0,
        relatedCountKnown: node.related_count !== undefined,
        importance: node.importance ?? 0.5,
        statsReady: true,
        state: node.state ?? "active",
        root: isVisualRoot(node),
        presentationScale: node.kind === "event"
          ? temporalProjection?.eventStarScale
          : temporalProjection?.nodeScale,
        presentationCardScale: temporalProjection?.cardScale,
        presentationOpacity: temporalProjection?.opacity,
        ...position,
      });
      exactByRaw.set(key, key);
      positionByRaw.set(key, position);
    };
    const preferredEntityRelation = (entityKey: string) =>
      [...(relationsByEntity.get(entityKey) ?? [])]
        .sort((left, right) => {
          const leftPlacement = timelineEventPlacementByKey.get(
            universeNodeKey("event", left.from_id, left.source_id),
          );
          const rightPlacement = timelineEventPlacementByKey.get(
            universeNodeKey("event", right.from_id, right.source_id),
          );
          return (rightPlacement?.index ?? -1) - (leftPlacement?.index ?? -1)
            || universeRelationKey(left).localeCompare(universeRelationKey(right));
        })[0];

    const rootEvents = visibleNodes.filter((node) => {
      if (node.kind !== "event") return false;
      return isVisualRoot(node);
    });
    rootEvents.forEach((node, index) => addExactNode(node, undefined, {
      index,
      total: rootEvents.length,
    }));
    visibleNodes
      .filter((node) => node.kind === "entity" && isVisualRoot(node))
      .forEach((node) => {
        const relation = preferredEntityRelation(
          universeNodeKey("entity", node.id, node.source_id),
        );
        addExactNode(
          node,
          relation
            ? positionByRaw.get(universeNodeKey("event", relation.from_id, relation.source_id))
            : undefined,
        );
      });
    visibleNodes
      .filter((node) => {
        const key = universeNodeKey(node.kind, node.id, node.source_id);
        return !exactByRaw.has(key);
      })
      .forEach((node) => {
        const key = universeNodeKey(node.kind, node.id, node.source_id);
        const relation = node.kind === "entity"
          ? preferredEntityRelation(key)
          : relationsByEvent.get(key)?.[0];
        const anchor = relation
          ? node.kind === "entity"
            ? positionByRaw.get(
                universeNodeKey("event", relation.from_id, relation.source_id),
              )
            : positionByRaw.get(
                universeNodeKey("entity", relation.to_id, relation.source_id),
              )
          : undefined;
        addExactNode(node, anchor);
      });

    projectedWorking.relations.forEach((relation) => {
      const source = exactByRaw.get(
        universeNodeKey("event", relation.from_id, relation.source_id),
      );
      const targetKind = relation.kind === "subevent" ? "event" : "entity";
      const target = exactByRaw.get(
        universeNodeKey(targetKind, relation.to_id, relation.source_id),
      );
      if (!source || !target) return;
      const temporalBundleId = temporalBundleByEventKey.get(
        universeNodeKey("event", relation.from_id, relation.source_id),
      );
      links.push({
        id: `${relation.source_id}:${relation.kind}:${relation.from_id}:${relation.to_id}`,
        source,
        target,
        weight: relation.weight,
        virtual: false,
        presentationOpacity: temporalBundleId
          ? temporalProjectionByBundleId.get(temporalBundleId)?.linkOpacity
          : undefined,
      });
    });
    const journeyCommit = timelineJourneyCommitRef.current;
    const windowChangeCause = timelineWindowRevision >= 0
      && journeyCommit?.session === sourceSessionRef.current
      && journeyCommit.revision === timelineWindowRevision
      && journeyCommit.cause === "journey"
      ? "journey"
      : "synchronization";
    const candidate = {
      epoch: working.epoch,
      windowRevision: sceneWindowRevision,
      windowChangeCause,
      windowDirection: windowChangeCause === "journey"
        ? journeyCommit?.direction
        : undefined,
      nodes,
      links,
    } satisfies UniverseSceneData;
    const signature = universeSceneDataSignature(candidate);
    const cached = graphDataCacheRef.current;
    const stableData = cached?.signature === signature
      ? cached.data
      : candidate;
    if (stableData === candidate) {
      graphDataCacheRef.current = { signature, data: candidate };
    }
    nodeByIdRef.current = new Map(stableData.nodes.map((node) => [node.id, node]));
    return stableData;
  }, [
    activePartition,
    browseSessionSourceId,
    manifest?.version,
    renderedSourcePartitions,
    sourceById,
    t,
    bundleWindow.visibleEventBundles,
    displayModeState,
    projectedEntityCategories,
    timelineBundleEntityLimit,
    timelineProjectionBudget,
    timelineCacheBundleIds,
    timelineVisibleBundleIds,
    timelineWindowRevision,
    working,
  ]);
  const selectedNode = React.useMemo(
    () => selectedKey
      ? graphData.nodes.find((node) => node.id === selectedKey) ?? null
      : null,
    [graphData, selectedKey],
  );
  React.useEffect(() => {
    const journeyCommit = timelineJourneyCommitRef.current;
    if (
      graphData.windowChangeCause !== "journey"
      || !journeyCommit
      || journeyCommit.session !== sourceSessionRef.current
      || journeyCommit.revision !== timelineWindowRevision
    ) return;
    // A journey marker describes exactly one scene delivery. Consuming it
    // prevents later expansion/filter synchronizations at the same timeline
    // revision from inheriting a stale forward/backward edge animation.
    timelineJourneyCommitRef.current = null;
  }, [graphData, timelineWindowRevision]);
  const selectedConcreteNode = React.useMemo(
    () => isConcreteUniverseNode(selectedNode) ? selectedNode : null,
    [selectedNode],
  );
  const visibleGraphCounts = React.useMemo(() => ({
    events: graphData.nodes.filter((node) => node.kind === "event").length,
    entities: graphData.nodes.filter((node) => node.kind === "entity").length,
    relations: graphData.links.length,
  }), [graphData.links.length, graphData.nodes]);
  const entityCategories = React.useMemo(
    () => [...new Set(working.nodes
      .filter((node) => node.kind === "entity")
      .map((node) => node.category?.trim())
      .filter((category): category is string => Boolean(category)))]
      .sort((left, right) => left.localeCompare(right, locale)),
    [locale, working.nodes],
  );
  React.useEffect(() => {
    if (entityCategories.length > 0) {
      publishUniverseEntityCategories(entityCategories);
    }
  }, [entityCategories]);
  const inspectorNode = selectedConcreteNode;
  const inspectorProgress = inspectorNode
    ? universeAnchorProgress(
        working,
        inspectorNode.kind,
        inspectorNode.rawId,
        inspectorNode.sourceId,
      )
    : 0;
  const inspectorTotal = inspectorNode
    ? Math.max(inspectorProgress, inspectorNode.relatedCount)
    : 0;
  const inspectorTotalKnown = Boolean(inspectorNode?.relatedCountKnown);
  const inspectorRemaining = inspectorTotalKnown
    ? Math.max(0, inspectorTotal - inspectorProgress)
    : null;
  const inspectorAnchorKey = inspectorNode
    ? universeNodeKey(inspectorNode.kind, inspectorNode.rawId, inspectorNode.sourceId)
    : null;
  const inspectorExhausted = Boolean(
    inspectorAnchorKey
    && expandedAnchorsRef.current.has(inspectorAnchorKey)
    && !cursorsRef.current.has(inspectorAnchorKey)
  );
  const inspectorCanExpand = !inspectorExhausted
    && (!inspectorTotalKnown || (inspectorRemaining ?? 0) > 0);

  const requestExpansion = React.useCallback(
    (
      node: Universe3DNode & { kind: "event" | "entity" },
      cursor: string | null,
      snapshot: ExpansionSnapshotContext | null,
      signal: AbortSignal,
    ) => {
      const epoch = epochRef.current;
      const boundCacheKey = snapshot
        ? universeExpansionCacheKey(
            epoch,
            node.sourceId,
            snapshot.sourceRevision,
            snapshot.snapshotId,
            node.kind,
            node.rawId,
            cursor,
          )
        : null;
      if (boundCacheKey) {
        const cached = expansionCacheRef.current.get(boundCacheKey);
        if (cached) {
          expansionCacheRef.current.delete(boundCacheKey);
          expansionCacheRef.current.set(boundCacheKey, cached);
          return Promise.resolve(cached);
        }
      }
      const inflightKey = boundCacheKey ?? [
        epoch,
        node.sourceId,
        "unsigned-root",
        node.kind,
        node.rawId,
      ].join(":");
      const pending = expansionInflightRef.current.get(inflightKey);
      if (pending && !pending.signal.aborted) return pending.promise;
      if (pending) expansionInflightRef.current.delete(inflightKey);
      const request = api
        .universeExpand(
          {
            epoch,
            source_id: node.sourceId,
            node_kind: node.kind,
            node_id: node.rawId,
            limit: node.kind === "event"
              ? Math.min(
                  EVENT_ENTITY_PROJECTION_LIMIT,
                  manifest?.policy.event_entity_limit ?? budgetRef.current.nodes,
                  Math.max(1, budgetRef.current.nodes - 1),
                )
              : Math.min(
                  ENTITY_EXPANSION_EVENT_LIMIT,
                  Math.max(1, bundleWindow.visibleEventBundles - 1),
                  Math.max(1, budgetRef.current.nodes - 1),
                ),
            cursor,
            snapshot_id: snapshot?.snapshotId ?? null,
          },
          signal,
        )
        .finally(() => {
          if (expansionInflightRef.current.get(inflightKey)?.promise === request) {
            expansionInflightRef.current.delete(inflightKey);
          }
        });
      expansionInflightRef.current.set(inflightKey, { promise: request, signal });
      return request;
    },
    [bundleWindow.visibleEventBundles, manifest?.policy.event_entity_limit],
  );

  const expandNode = React.useCallback(
    async (node: Universe3DNode) => {
      if (!interactiveRef.current) return;
      if ((node.kind !== "event" && node.kind !== "entity") || !node.sourceId) return;
      const exactNode = node as Universe3DNode & { kind: "event" | "entity" };
      const anchorKey = universeNodeKey(exactNode.kind, exactNode.rawId, exactNode.sourceId);
      const cursor = cursorsRef.current.get(anchorKey) ?? null;
      if (
        expandedAnchorsRef.current.has(anchorKey)
        && !cursor
      ) return;
      const browseSession = activationOriginRef.current === "browse"
        ? sourceSessionRef.current
        : null;
      const requestSession = sourceSessionRef.current;
      const lineageRootKey = browseSession
        ? expansionLineageRootKey(
            workingRef.current,
            browseSession.timeline.window.cacheBundleIds,
            anchorKey,
          )
        : anchorKey;
      if (!lineageRootKey) {
        setMoreHint(t("errors.relatedLoadFailed"));
        return;
      }
      let snapshot = expansionSnapshotsRef.current.get(exactNode.sourceId) ?? null;
      if (activationOriginRef.current === "browse") {
        const timeline = browseSession?.sourceId === exactNode.sourceId
          ? browseSession.timeline
          : null;
        if (!timeline?.snapshotId || !timeline.sourceRevision || !timeline.asOf) {
          setMoreHint(t("timeline.loading"));
          return;
        }
        snapshot = {
          snapshotId: timeline.snapshotId,
          sourceRevision: timeline.sourceRevision,
          asOf: timeline.asOf,
        };
        expansionSnapshotsRef.current.set(exactNode.sourceId, snapshot);
      }
      if (cursor && !snapshot) {
        cursorsRef.current.delete(anchorKey);
        expandedAnchorsRef.current.delete(anchorKey);
        setMoreHint(t("errors.relatedLoadFailed"));
        return;
      }
      expandAbortRef.current?.abort();
      const controller = new AbortController();
      expandAbortRef.current = controller;
      expandingAnchorRef.current = anchorKey;
      const requestEpoch = epochRef.current;
      setExpandingKey(node.id);
      setMoreHint("");
      try {
        const patch = await requestExpansion(
          exactNode,
          cursor,
          snapshot,
          controller.signal,
        );
        if (
          patch.epoch !== epochRef.current
          || controller.signal.aborted
          || !interactiveRef.current
          || sourceSessionRef.current !== requestSession
          || (cursorsRef.current.get(anchorKey) ?? null) !== cursor
          || !workingRef.current.nodes.some((item) =>
            universeNodeKey(item.kind, item.id, item.source_id) === anchorKey)
        ) return;
        const admissionWorking = workingRef.current;
        const currentLineageRootKey = browseSession
          ? expansionLineageRootKey(
              admissionWorking,
              browseSession.timeline.window.cacheBundleIds,
              anchorKey,
            )
          : anchorKey;
        if (currentLineageRootKey !== lineageRootKey) return;
        const windowProtection = browseSession
          ? universeBundleWindowProtection(
              admissionWorking,
              browseSession.timeline.window.cacheBundleIds,
            )
          : { nodeKeys: [], relationKeys: [] };
        let visibleSupportBundleIds: string[] = [];
        if (browseSession) {
          const categoryProjectedAdmission = projectUniverseWorkingSet(
            admissionWorking,
            projectedEntityCategories,
          );
          const projectionIds = timelineProjectionBundleIds(
            categoryProjectedAdmission,
            browseSession.timeline.window.cacheBundleIds,
            browseSession.timeline.window.visibleBundleIds,
          );
          const visibleTimelineIds = new Set(
            browseSession.timeline.window.visibleBundleIds,
          );
          const supportIds = projectionIds.filter((id) =>
            !visibleTimelineIds.has(id));
          const visibleProjection = projectUniverseBundleWindowWithinBudget(
            categoryProjectedAdmission,
            browseSession.timeline.window.visibleBundleIds,
            [...supportIds].reverse(),
            timelineProjectionBudget,
            browseSession.timeline.window.visibleLimit,
            timelineBundleEntityLimit,
          );
          visibleSupportBundleIds = visibleProjection.bundle_order.filter((id) =>
            categoryProjectedAdmission.bundles[id]?.origin === "expansion");
        }
        const admission = admitUniverseExpansionPage(
          admissionWorking,
          patch,
          {
            epoch: requestEpoch,
            sourceId: exactNode.sourceId,
            nodeKind: exactNode.kind,
            nodeId: exactNode.rawId,
            lineageRootKey,
            requestCursor: cursor,
            snapshotId: snapshot?.snapshotId ?? null,
            sourceRevision: snapshot?.sourceRevision ?? null,
            asOf: snapshot?.asOf ?? null,
          },
          browseSession ? residentBudgetRef.current : budgetRef.current,
          Date.now(),
          {
            protectedKeys: [anchorKey, ...windowProtection.nodeKeys],
            protectedRelationKeys: windowProtection.relationKeys,
            protectedBundleIds: [
              ...(browseSession?.timeline.window.cacheBundleIds ?? []),
              ...visibleSupportBundleIds,
            ],
          },
        );
        if (!admission.accepted) {
          setMoreHint(
            admission.reason === "protected_capacity"
              || admission.reason === "over_budget"
              ? t("expansion.capacityReached")
              : t("errors.relatedLoadFailed"),
          );
          return;
        }
        const admittedBundle = admission.workingSet.bundles[patch.bundle_id];
        if (
          !admittedBundle
          || admittedBundle.lineage_root_key !== lineageRootKey
          || (
            browseSession
            && !browseSession.timeline.window.cacheBundleIds.some((id) =>
              admission.workingSet.bundles[id]?.node_keys.includes(lineageRootKey))
          )
        ) return;
        const next = admission.workingSet;
        const responseSnapshot = {
          snapshotId: patch.snapshot_id,
          sourceRevision: patch.source_revision,
          asOf: patch.as_of,
        };
        expansionSnapshotsRef.current.set(exactNode.sourceId, responseSnapshot);
        const cacheKey = universeExpansionCacheKey(
          requestEpoch,
          exactNode.sourceId,
          responseSnapshot.sourceRevision,
          responseSnapshot.snapshotId,
          exactNode.kind,
          exactNode.rawId,
          cursor,
        );
        expansionCacheRef.current.set(cacheKey, patch);
        while (expansionCacheRef.current.size > 24) {
          const oldest = expansionCacheRef.current.keys().next().value;
          if (typeof oldest !== "string") break;
          expansionCacheRef.current.delete(oldest);
        }
        commitWorkingSet(next);
        pruneExpansionState(next);
        dispatchUniversePatch(patch);
        setSummary((current) => ({
          query: current?.query ?? node.label,
          events: next.nodes.filter((item) => item.kind === "event").length,
          entities: next.nodes.filter((item) => item.kind === "entity").length,
          relations: next.relations.length,
        }));
        const committedCount = universeAnchorProgress(
          next,
          exactNode.kind,
          exactNode.rawId,
          exactNode.sourceId,
        );
        const totalCount = Math.max(committedCount, patch.anchor.related_count);
        if (admission.nextCursor) {
          expandedAnchorsRef.current.add(anchorKey);
          cursorsRef.current.set(anchorKey, admission.nextCursor);
        } else {
          cursorsRef.current.delete(anchorKey);
          if (committedCount >= totalCount) expandedAnchorsRef.current.add(anchorKey);
          else expandedAnchorsRef.current.delete(anchorKey);
        }
        const relationLabel = exactNode.kind === "entity"
          ? t("nodeKinds.relatedEvents")
          : t("nodeKinds.relatedEntities");
        setMoreHint(
          patch.page.has_more || committedCount < totalCount
            ? t("expansion.pageMore", { committed: committedCount, total: totalCount, relation: relationLabel })
            : t("expansion.complete", { total: totalCount, relation: relationLabel }),
        );
      } catch (reason) {
        if (reason instanceof ApiError && reason.code === "aborted") return;
        if (
          controller.signal.aborted
          || requestEpoch !== epochRef.current
          || !interactiveRef.current
          || sourceSessionRef.current !== requestSession
        ) return;
        if (reason instanceof ApiError && reason.code === "snapshot_changed") {
          invalidateSourceSnapshot(exactNode.sourceId, requestEpoch);
          return;
        }
        setMoreHint(reason instanceof ApiError ? reason.message : t("errors.relatedLoadFailed"));
      } finally {
        if (expandAbortRef.current === controller) {
          expandAbortRef.current = null;
          expandingAnchorRef.current = null;
          if (requestEpoch === epochRef.current) setExpandingKey(null);
        }
      }
    },
    [
      commitWorkingSet,
      invalidateSourceSnapshot,
      pruneExpansionState,
      projectedEntityCategories,
      requestExpansion,
      t,
      timelineBundleEntityLimit,
      timelineProjectionBudget,
    ],
  );

  const loadSourceTimelinePage = React.useCallback(
    (
      sourceId: string,
      cause: SourceTimelineLoadCause,
      direction: UniverseTimelineDirection = "older",
    ): Promise<SourceTimelineLoadResult> => {
      if (!manifest || !interactiveRef.current) return Promise.resolve("blocked");
      const inFlight = timelineRequestRef.current;
      if (inFlight) return inFlight;

      const session = sourceSessionRef.current;
      if (!session || session.sourceId !== sourceId) {
        return Promise.resolve("blocked");
      }
      const state = session.timeline;
      if (state.loading || state.pausedReason) return Promise.resolve("blocked");
      if (lockedKeyRef.current && cause !== "source-entry") {
        return Promise.resolve("blocked");
      }
      if (state.deque === null && direction !== "older") {
        return Promise.resolve("blocked");
      }
      if (
        state.deque
        && (
          (direction === "older" && !state.deque.hasOlder)
          || (direction === "newer" && !state.deque.hasNewer)
        )
      ) return Promise.resolve("blocked");

      const epoch = epochRef.current;
      const source = sourceById.get(sourceId);
      const pageBundleLimit = state.queryPageSize ?? universeTimelinePageBundleLimit(
        manifest.policy.timeline_event_page_size,
        Math.min(EVENT_ENTITY_PROJECTION_LIMIT, manifest.policy.event_entity_limit),
        residentBudgetRef.current,
      );
      const requestCursor = state.deque === null
        ? null
        : direction === "older"
          ? state.deque.olderCursor
          : state.deque.newerCursor;
      const controller = new AbortController();
      state.loading = true;
      if (cause !== "prefetch") {
        commitTimelineWindow(session, {
          ...state.window,
          phase: "loading",
        });
        setMoreHint(t("timeline.loading"));
      }
      refreshLoadProgress();
      timelineAbortRef.current?.abort();
      timelineAbortRef.current = controller;
      timelineLoadCauseRef.current = cause;

      let loadResult: SourceTimelineLoadResult = "blocked";
      const request = (async (): Promise<SourceTimelineLoadResult> => {
        try {
          const firstPage = state.deque === null;
          const page = await api.universeTimeline(
            {
              epoch,
              source_id: sourceId,
              limit: pageBundleLimit,
              direction,
              cursor: requestCursor,
              snapshot_id: state.snapshotId,
            },
            controller.signal,
          );
          if (
            page.epoch !== epochRef.current
            || controller.signal.aborted
            || !interactiveRef.current
            || sourceSessionRef.current !== session
          ) return "blocked";
          if (
            page.source_id !== sourceId
            || page.request_direction !== direction
            || page.request_cursor !== requestCursor
            || (state.snapshotId !== null && page.snapshot_id !== state.snapshotId)
            || (
              state.sourceRevision !== null
              && page.source_revision !== state.sourceRevision
            )
            || (state.asOf !== null && page.as_of !== state.asOf)
          ) {
            throw new Error("timeline response does not match the active snapshot");
          }

          const previousDeque = state.deque;
          const dequeAdmission = admitUniverseTimelineDequePage(
            previousDeque,
            page,
            state.window.cacheLimit,
          );
          const synchronizedWindow = synchronizeTimelineWindowWithDeque(
            state.window,
            previousDeque,
            dequeAdmission,
          );
          if (!synchronizedWindow) {
            state.pausedReason = "capacity";
            if (cause !== "prefetch") {
              setMoreHint(t("timeline.capacityPaused", {
                count: queriedUniverseTimelineEventCount(state.window),
              }));
            }
            return "blocked";
          }

          // The deque has already decided the fixed-cache edge retirement.
          // Protect only its final retained identities so the working set can
          // release the retired edge while admitting the complete new page.
          const protectedTimelineBundleIds = synchronizedWindow.cacheBundleIds;
          const admissionWorking = workingRef.current;
          const windowProtection = universeBundleWindowProtection(
            admissionWorking,
            protectedTimelineBundleIds,
          );
          const categoryProjectedAdmission = projectUniverseWorkingSet(
            admissionWorking,
            projectedEntityCategories,
          );
          const currentProjectionIds = timelineProjectionBundleIds(
            categoryProjectedAdmission,
            synchronizedWindow.cacheBundleIds,
            synchronizedWindow.visibleBundleIds,
          );
          const visibleTimelineIds = new Set(synchronizedWindow.visibleBundleIds);
          const visibleSupportBundleIds = projectUniverseBundleWindowWithinBudget(
            categoryProjectedAdmission,
            synchronizedWindow.visibleBundleIds,
            currentProjectionIds
              .filter((id) => !visibleTimelineIds.has(id))
              .reverse(),
            timelineProjectionBudget,
            synchronizedWindow.visibleLimit,
            timelineBundleEntityLimit,
          ).bundle_order.filter(
            (id) => categoryProjectedAdmission.bundles[id]?.origin === "expansion",
          );
          const admission = admitUniverseTimelinePage(
            admissionWorking,
            page,
            residentBudgetRef.current,
            Date.now(),
            {
              roots: true,
              protectedKeys: [
                ...windowProtection.nodeKeys,
                ...(lockedKeyRef.current ? [lockedKeyRef.current] : []),
              ],
              protectedRelationKeys: windowProtection.relationKeys,
              protectedBundleIds: [
                ...protectedTimelineBundleIds,
                ...visibleSupportBundleIds,
              ],
            },
          );
          const retainedDequeIds = new Set(
            dequeAdmission.deque.bundles.map((bundle) => bundle.bundle_id),
          );
          if (
            !admission.pageAcknowledged
            || admission.evictedBundleIds.some((id) => retainedDequeIds.has(id))
          ) {
            state.pausedReason = "capacity";
            if (cause !== "prefetch") {
              setMoreHint(t("timeline.capacityPaused", {
                count: queriedUniverseTimelineEventCount(state.window),
              }));
            }
            return "blocked";
          }

          state.snapshotId = page.snapshot_id;
          state.sourceRevision = page.source_revision;
          state.asOf = page.as_of;
          state.queryPageSize ??= pageBundleLimit;
          state.deque = dequeAdmission.deque;
          state.pausedReason = null;
          expansionSnapshotsRef.current.set(sourceId, {
            snapshotId: page.snapshot_id,
            sourceRevision: page.source_revision,
            asOf: page.as_of,
          });
          commitTimelineWindow(session, synchronizedWindow);

          const retainedIds = timelineRetentionBundleIds(
            admission.workingSet,
            synchronizedWindow.cacheBundleIds,
          );
          const retainedWorking = retainUniverseWorkingSetBundles(
            admission.workingSet,
            retainedIds,
          );
          commitWorkingSet(retainedWorking);
          pruneExpansionState(retainedWorking);

          const residentKeys = new Set(retainedWorking.nodes.map((node) =>
            universeNodeKey(node.kind, node.id, node.source_id)));
          page.bundles.forEach((bundle) => {
            const eventKey = universeNodeKey("event", bundle.event.id, sourceId);
            if (!residentKeys.has(eventKey)) return;
            if (
              expandedAnchorsRef.current.has(eventKey)
              || cursorsRef.current.has(eventKey)
            ) return;
            expandedAnchorsRef.current.add(eventKey);
            if (bundle.neighbor_page.next_cursor) {
              cursorsRef.current.set(eventKey, bundle.neighbor_page.next_cursor);
            }
          });
          loadResult = "loaded";
          refreshLoadProgress();

          if (firstPage && admission.committedNodes.length) {
            const focusEpoch = epoch;
            cameraFrameRef.current = window.requestAnimationFrame(() => {
              cameraFrameRef.current = null;
              focusTimerRef.current = window.setTimeout(() => {
                focusTimerRef.current = null;
                if (epochRef.current === focusEpoch) graphRef.current?.focusSource(sourceId);
              }, reducedMotion ? 40 : 720);
            });
          }
          if (activationOriginRef.current === "browse") {
            setSummary({
              query: source?.label ?? t("timeline.defaultTitle"),
              events: queriedUniverseTimelineEventCount(synchronizedWindow),
              entities: retainedWorking.nodes.filter((node) =>
                node.kind === "entity" && node.source_id === sourceId).length,
              relations: retainedWorking.relations.length,
            });
          }
          if (cause !== "prefetch" && synchronizedWindow.phase === "complete") {
            setMoreHint(t("timeline.explorationComplete", {
              source: source?.label ?? t("timeline.thisGalaxy"),
            }));
          } else if (cause !== "prefetch") {
            setMoreHint(t("timeline.windowReady", {
              visible: synchronizedWindow.visibleBundleIds.length,
            }));
          }
          return loadResult;
        } catch (reason) {
          if (reason instanceof ApiError && reason.code === "aborted") {
            return "blocked";
          }
          if (
            reason instanceof ApiError
            && reason.code === "snapshot_changed"
            && sourceSessionRef.current === session
          ) {
            invalidateSourceSnapshot(sourceId, epoch);
            return "blocked";
          }
          if (cause !== "prefetch") {
            setMoreHint(
              reason instanceof ApiError ? reason.message : t("errors.timelineLoadFailed"),
            );
          }
          return "blocked";
        } finally {
          state.loading = false;
          if (sourceSessionRef.current === session) {
            commitTimelineWindow(session, settleUniverseTimelineWindow(state.window));
          }
          refreshLoadProgress();
          if (timelineAbortRef.current === controller) {
            timelineAbortRef.current = null;
            timelineLoadCauseRef.current = null;
          }
        }
      })();
      timelineRequestRef.current = request;
      void request.finally(() => {
        if (timelineRequestRef.current === request) timelineRequestRef.current = null;
      });
      return request;
    },
    [
      commitTimelineWindow,
      commitWorkingSet,
      invalidateSourceSnapshot,
      manifest,
      pruneExpansionState,
      projectedEntityCategories,
      reducedMotion,
      refreshLoadProgress,
      sourceById,
      t,
      timelineBundleEntityLimit,
      timelineProjectionBudget,
    ],
  );
  timelinePageLoaderRef.current = loadSourceTimelinePage;

  React.useEffect(() => {
    const session = sourceSessionRef.current;
    if (!session || session.timeline.loading) return;
    const current = session.timeline.window;
    if (current.phase === "transitioning") return;

    let next = current;
    const deque = session.timeline.deque;
    if (deque && current.activeIndex >= 0) {
      const activeBundleId = current.cacheBundleIds[current.activeIndex];
      const pageSize = session.timeline.queryPageSize
        ?? Math.max(1, manifest?.policy.timeline_event_page_size ?? 6);
      const resized = activeBundleId
        ? resizeUniverseTimelineDeque(
            deque,
            bundleWindow.cachedEventBundles,
            activeBundleId,
            bundleWindow.visibleEventBundles,
            pageSize,
          )
        : null;
      const anchor = resized && activeBundleId
        ? syncUniverseTimelineWindowToDeque(resized.deque, {
            activeBundleId,
            activeIndex: current.activeIndex,
            visibleLimit: bundleWindow.visibleEventBundles,
          })
        : null;
      if (resized && anchor) {
        session.timeline.deque = resized.deque;
        const cacheStartOffset = current.cacheStartOffset
          + resized.evictedNewerBundleIds.length;
        const networkExhausted = !resized.deque.hasOlder;
        const phase = networkExhausted
          && anchor.activeIndex === anchor.cacheBundleIds.length - 1
          ? "complete" as const
          : "idle" as const;
        const changed = current.visibleLimit !== bundleWindow.visibleEventBundles
          || current.cacheLimit !== bundleWindow.cachedEventBundles
          || current.activeIndex !== anchor.activeIndex
          || current.phase !== phase
          || current.cacheBundleIds.length !== anchor.cacheBundleIds.length
          || current.cacheBundleIds.some(
            (id, index) => id !== anchor.cacheBundleIds[index],
          )
          || current.visibleBundleIds.length !== anchor.visibleBundleIds.length
          || current.visibleBundleIds.some(
            (id, index) => id !== anchor.visibleBundleIds[index],
          );
        if (changed) {
          next = {
            ...current,
            cacheBundleIds: anchor.cacheBundleIds,
            activeIndex: anchor.activeIndex,
            visibleBundleIds: anchor.visibleBundleIds,
            visitedCount: Math.max(
              current.visitedCount,
              cacheStartOffset + anchor.activeIndex + 1,
            ),
            networkExhausted,
            phase,
            revision: current.revision + 1,
            visibleLimit: bundleWindow.visibleEventBundles,
            cacheLimit: bundleWindow.cachedEventBundles,
            cacheStartOffset,
          };
        }
      }
    } else {
      next = reconfigureUniverseTimelineWindow(
        current,
        bundleWindow.visibleEventBundles,
        bundleWindow.cachedEventBundles,
      );
    }
    if (next !== current) commitTimelineWindow(session, next);

    const resident = workingRef.current;
    const retainedIds = timelineRetentionBundleIds(
      resident,
      next.cacheBundleIds,
    );
    const retained = retainUniverseWorkingSetBundles(
      resident,
      retainedIds,
    );
    if (session.timeline.pausedReason === "capacity") {
      session.timeline.pausedReason = null;
      setMoreHint("");
      refreshLoadProgress();
    }
    const bundleOrderChanged = retained.bundle_order.length
      !== resident.bundle_order.length
      || retained.bundle_order.some((id, index) => id !== resident.bundle_order[index]);
    if (!bundleOrderChanged) return;
    commitWorkingSet(retained);
    pruneExpansionState(retained);
  }, [
    bundleWindow,
    commitTimelineWindow,
    commitWorkingSet,
    manifest?.policy.timeline_event_page_size,
    pruneExpansionState,
    refreshLoadProgress,
    timelineWindow,
  ]);

  const activateSource = React.useCallback(
    (sourceId: string) => {
      if (!sourceById.has(sourceId)) return;
      // Explicit source navigation starts a timeline browse session even when
      // the user arrived from search or an assistant-provided activation.
      activationOriginRef.current = "browse";
      setActivationOrigin("browse");
      setSourceHits([]);
      clearCameraSchedule();
      expandAbortRef.current?.abort();
      expandAbortRef.current = null;
      expandingAnchorRef.current = null;
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      dispatchUniversePatchReset();
      expansionSnapshotsRef.current.clear();
      cursorsRef.current.clear();
      expandedAnchorsRef.current.clear();
      const previousSession = sourceSessionRef.current;
      if (previousSession) previousSession.timeline.loading = false;
      timelineAbortRef.current?.abort();
      timelineAbortRef.current = null;
      timelineLoadCauseRef.current = null;
      timelineRequestRef.current = null;
      if (snapshotReloadTimerRef.current !== null) {
        window.clearTimeout(snapshotReloadTimerRef.current);
        snapshotReloadTimerRef.current = null;
      }
      snapshotReloadAttemptsRef.current.clear();
      clearTimelineSettle();
      setExpandingKey(null);
      graphRef.current?.unlockNode();
      setLockedKey(null);
      setSelectedKey(null);

      if (epochRef.current === 0) epochRef.current = 1;
      const session = emptySourceBrowseSession(
        epochRef.current,
        sourceId,
        bundleWindow.visibleEventBundles,
        bundleWindow.cachedEventBundles,
      );
      sourceSessionRef.current = session;
      updateDisplayMode(() => createUniverseDisplayModeState());
      completedSourcesRef.current.clear();

      commitWorkingSet(session.working);
      pruneExpansionState(session.working);
      setTimelineWindow(session.timeline.window);
      refreshLoadProgress();
      setActivePartition(sourceId);
      focusPartition(sourceId);
      void loadSourceTimelinePage(sourceId, "source-entry");
    },
    [
      bundleWindow,
      clearCameraSchedule,
      clearTimelineSettle,
      commitWorkingSet,
      focusPartition,
      loadSourceTimelinePage,
      pruneExpansionState,
      refreshLoadProgress,
      setLockedKey,
      setSelectedKey,
      sourceById,
      updateDisplayMode,
    ],
  );

  React.useEffect(() => {
    const onSourceFocus = (event: Event) => {
      const sourceId = (
        event as CustomEvent<{ source_id: string }>
      ).detail?.source_id;
      if (sourceId) activateSource(sourceId);
    };
    window.addEventListener(UNIVERSE_SOURCE_FOCUS_EVENT, onSourceFocus);
    return () => window.removeEventListener(UNIVERSE_SOURCE_FOCUS_EVENT, onSourceFocus);
  }, [activateSource]);

  const activatePartition = React.useCallback(
    (node: Universe3DNode) => activateSource(node.sourceId),
    [activateSource],
  );

  const handleSourceLod = React.useCallback(
    (sourceId: string, level: 0 | 1 | 2 | 3) => {
      if (!interactiveRef.current) return;
      if (level < 1) return;
      // Camera LOD is visual feedback, not source navigation. Once a browse
      // session owns the timeline, a nearby partition must not replace its
      // active source and unmount the pager for the loaded session.
      const sessionSourceId = sourceSessionRef.current?.sourceId;
      if (sessionSourceId && sessionSourceId !== sourceId) return;
      setActivePartition(sourceId);
    },
    [],
  );

  const handleTimelineIntent = React.useCallback(
    async (direction: "next" | "previous"): Promise<UniverseTimelineIntentResult> => {
      const session = sourceSessionRef.current;
      if (
        !session
        || activationOriginRef.current !== "browse"
      ) return "blocked";
      if (lockedKeyRef.current) {
        setMoreHint(t("timeline.unlockToContinue"));
        return "blocked";
      }

      const queryPageSize = session.timeline.queryPageSize ?? universeTimelinePageBundleLimit(
        manifest?.policy.timeline_event_page_size ?? 6,
        Math.min(
          EVENT_ENTITY_PROJECTION_LIMIT,
          manifest?.policy.event_entity_limit ?? EVENT_ENTITY_PROJECTION_LIMIT,
        ),
        residentBudgetRef.current,
      );
      // Network pages remain large for efficient bidirectional prefetch. The
      // visual page is capped by the configured window so every queried event
      // is eventually shown instead of being skipped by a wider stride.
      const pageStride = Math.min(
        queryPageSize,
        session.timeline.window.visibleLimit,
      );
      const requestDirection: UniverseTimelineDirection =
        direction === "next" ? "older" : "newer";
      session.timeline.preferredDirection = requestDirection;
      const displayPlan: UniverseDisplayIntentPlan =
        planUniverseDisplayTimelineIntent(
          displayModeRef.current,
          direction,
          session.timeline.window.revision,
        );

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = session.timeline.window;
        const rewindFloor = universeTimelineRewindStartActiveIndex(current);
        const localRunway = direction === "next"
          ? current.cacheBundleIds.length - current.activeIndex - 1
          : current.activeIndex - rewindFloor;
        if (localRunway >= pageStride) break;
        const edgeAvailable = direction === "next"
          ? session.timeline.deque?.hasOlder
          : session.timeline.deque?.hasNewer;
        if (!edgeAvailable) break;
        await loadSourceTimelinePage(
          session.sourceId,
          "journey",
          requestDirection,
        );
        if (sourceSessionRef.current !== session) return "blocked";
      }

      const current = session.timeline.window;
      const rewindFloor = universeTimelineRewindStartActiveIndex(current);
      const localRunway = direction === "next"
        ? current.cacheBundleIds.length - current.activeIndex - 1
        : current.activeIndex - rewindFloor;
      const edgeAvailable = direction === "next"
        ? session.timeline.deque?.hasOlder
        : session.timeline.deque?.hasNewer;
      const completeTerminalPage = localRunway > 0 && !edgeAvailable;
      if (localRunway < pageStride && !completeTerminalPage) {
        if (session.timeline.pausedReason === "capacity") {
          setMoreHint(t("timeline.capacityPaused", {
            count: queriedUniverseTimelineEventCount(current),
          }));
        }
        return "blocked";
      }
      const next = advanceUniverseTimelineWindow(
        current,
        direction,
        pageStride,
      );
      if (next === current || next.revision === current.revision) {
        if (direction === "next" && !session.timeline.deque?.hasOlder) {
          const complete = markUniverseTimelineNetworkExhausted(current);
          commitTimelineWindow(session, complete);
          setMoreHint(t("timeline.explorationComplete", {
            source: sourceById.get(session.sourceId)?.label ?? t("timeline.thisGalaxy"),
          }));
          return "complete";
        }
        if (session.timeline.pausedReason === "capacity") {
          setMoreHint(t("timeline.capacityPaused", {
            count: queriedUniverseTimelineEventCount(current),
          }));
        }
        return "blocked";
      }

      updateDisplayMode((state) =>
        commitUniverseDisplayIntent(state, displayPlan, "shifted"));
      timelineJourneyCommitRef.current = {
        session,
        revision: next.revision,
        cause: "journey",
        direction,
      };
      commitTimelineWindow(session, next);
      scheduleTimelineSettle(session, next);
      if (next.phase === "complete") {
        setMoreHint(t("timeline.explorationComplete", {
          source: sourceById.get(session.sourceId)?.label ?? t("timeline.thisGalaxy"),
        }));
      } else {
        setMoreHint(t(direction === "next"
          ? "timeline.movedEarlier"
          : "timeline.movedLater"));
      }
      return "advanced";
    },
    [
      commitTimelineWindow,
      loadSourceTimelinePage,
      manifest?.policy.event_entity_limit,
      manifest?.policy.timeline_event_page_size,
      scheduleTimelineSettle,
      sourceById,
      t,
      updateDisplayMode,
    ],
  );

  React.useEffect(() => {
    const session = sourceSessionRef.current;
    if (
      !interactive
      || activationOrigin !== "browse"
      || !session
      || session.timeline.loading
      || session.timeline.pausedReason
      || lockedKey
      || timelineWindow?.phase !== "idle"
      || !session.timeline.deque
    ) return;
    const current = session.timeline.window;
    const nextPageSize = session.timeline.queryPageSize ?? universeTimelinePageBundleLimit(
      manifest?.policy.timeline_event_page_size ?? 6,
      Math.min(
        EVENT_ENTITY_PROJECTION_LIMIT,
        manifest?.policy.event_entity_limit ?? EVENT_ENTITY_PROJECTION_LIMIT,
      ),
      residentBudget,
    );
    const plan = planUniverseTimelinePrefetch({
      cacheLength: current.cacheBundleIds.length,
      activeIndex: current.activeIndex,
      visibleLimit: current.visibleLimit,
      cacheLimit: current.cacheLimit,
      hasOlder: session.timeline.deque.hasOlder,
      hasNewer: session.timeline.deque.hasNewer,
      pageSize: nextPageSize,
      preferredDirection: session.timeline.preferredDirection,
    });
    if (!plan.direction) return;
    void loadSourceTimelinePage(
      session.sourceId,
      "prefetch",
      plan.direction,
    );
  }, [
    activationOrigin,
    interactive,
    loadSourceTimelinePage,
    lockedKey,
    manifest?.policy.event_entity_limit,
    manifest?.policy.timeline_event_page_size,
    residentBudget,
    timelineWindow,
  ]);

  const timelineJourney = React.useMemo<UniverseTimelineJourney>(() => {
    const enabled = Boolean(
      interactive
      && browseSessionSourceId
      && timelineWindow
      && timelineWindow.cacheBundleIds.length > 0,
    );
    const activeIndex = timelineWindow?.activeIndex ?? -1;
    const cacheLength = timelineWindow?.cacheBundleIds.length ?? 0;
    const startActiveIndex = timelineWindow
      ? universeTimelineRewindStartActiveIndex(timelineWindow)
      : -1;
    const activeDeque = browseSessionSourceId
      ? sourceSessionRef.current?.timeline.deque ?? null
      : null;
    const hasOlder = activeDeque?.hasOlder ?? false;
    const hasNewer = activeDeque?.hasNewer ?? false;
    const networkExhausted = !hasOlder;
    return {
      enabled,
      phase: timelineWindow?.phase ?? "idle",
      hasNext: enabled
        && (activeIndex < cacheLength - 1 || hasOlder),
      hasPrevious: enabled && (activeIndex > startActiveIndex || hasNewer),
      networkExhausted,
      revision: timelineWindow?.revision ?? 0,
    };
  }, [
    browseSessionSourceId,
    interactive,
    timelineWindow,
  ]);

  // Keep the pager mounted for the lifetime of an active browse session.
  // Journey readiness only controls the individual buttons: coupling the
  // whole toolbar to a populated cache made it disappear during page loads,
  // deque synchronization, and other short-lived timeline transitions.
  const timelineControlsVisible = Boolean(
    interactive
    && browseSessionSourceId
    && timelineWindow,
  );

  const visibleTimelineRange = React.useMemo(() => {
    const session = sourceSessionRef.current;
    if (!session?.timeline.deque || !timelineWindow || timelineWindow.activeIndex < 0) {
      return t("controls.unknownTime");
    }
    const visibleIds = new Set(timelineWindow.visibleBundleIds);
    const visibleBundles = session.timeline.deque.bundles
      .filter((bundle) => visibleIds.has(bundle.bundle_id));
    const values = visibleBundles
      .map((bundle) => bundle.event.start_time)
      .filter((value): value is string => typeof value === "string")
      .map((value) => ({ value, timestamp: Date.parse(value) }))
      .filter((item) => Number.isFinite(item.timestamp));
    if (values.length === 0) return t("controls.unknownTime");
    const includesClock = values.some(({ value }) =>
      !/T00:00(?::00(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?$/.test(value));
    const formatter = new Intl.DateTimeFormat(locale, includesClock
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" });
    const oldest = Math.min(...values.map((item) => item.timestamp));
    const newest = Math.max(...values.map((item) => item.timestamp));
    const oldestLabel = formatter.format(new Date(oldest));
    const newestLabel = formatter.format(new Date(newest));
    const range = oldest === newest ? oldestLabel : `${oldestLabel} – ${newestLabel}`;
    return values.length < visibleBundles.length
      ? t("controls.partialTime", { time: range })
      : range;
  }, [locale, t, timelineWindow]);

  const handleSceneViewChange = React.useCallback(
    (view: UniverseSceneView) => {
      if (!interactiveRef.current) return;
      dispatchUniverseView({
        mode: view.mode,
        source_id: view.sourceId,
        progress: view.progress,
      });
      if (viewportSourceRef.current === view.sourceId) return;
      viewportSourceRef.current = view.sourceId;
      setViewportSourceId(view.sourceId);
    },
    [],
  );

  const handleNodeClick = React.useCallback(
    (node: UniverseSceneNode) => {
      if (node.kind === "source") {
        activatePartition(node as Universe3DNode);
        return;
      }
      const exact = node as Universe3DNode & { kind: "event" | "entity" };
      const nextLockedId = nextUniverseLockedNodeId(
        lockedKeyRef.current,
        exact.id,
      );
      if (!nextLockedId) {
        graphRef.current?.clearSelection();
        setLockedKey(null);
        setSelectedKey(null);
        return;
      }

      // A node click is a presentation-only action. Explicit expansion remains
      // available from the inspector, while locking cancels any in-flight
      // automatic timeline request before it can mutate the working set.
      if (timelineLoadCauseRef.current !== "source-entry") {
        timelineAbortRef.current?.abort();
      }
      setLockedKey(nextLockedId);
      setSelectedKey(nextLockedId);
      graphRef.current?.lockNode(nextLockedId);
    },
    [activatePartition, setLockedKey, setSelectedKey],
  );

  const clearSelection = React.useCallback(() => {
    graphRef.current?.clearSelection();
    setLockedKey(null);
    setSelectedKey(null);
  }, [setLockedKey, setSelectedKey]);

  const handleSceneUnavailable = React.useCallback((reason: UniverseSceneUnavailableReason) => {
    // Rendering failure must not invalidate the already loaded cache/window.
    // Retaining it makes a renderer retry a visual remount instead of a data reload.
    setSceneUnavailableReason((current) => current ?? reason);
  }, []);

  const retryScene = React.useCallback(() => {
    if (sceneRetryFrameRef.current !== null) return;
    setSceneUnavailableReason(null);
    setWebglAvailable(null);
    // Keep one paint with no canvas so Chrome can retire the previous context
    // before the renderer asks for another one.
    sceneRetryFrameRef.current = window.requestAnimationFrame(() => {
      sceneRetryFrameRef.current = null;
      setSceneAttempt((current) => current + 1);
    });
  }, []);

  const resetUniversePresentation = React.useCallback(() => {
    graphRef.current?.resetOverview();
    viewportSourceRef.current = null;
    setViewportSourceId(null);
    setActivePartition(null);
    setLockedKey(null);
    setSelectedKey(null);
  }, [setLockedKey, setSelectedKey]);

  React.useEffect(() => {
    const visibleNodeIds = new Set(graphData.nodes.map((node) => node.id));
    const selectedMissing = Boolean(selectedKey && !visibleNodeIds.has(selectedKey));
    const lockedMissing = Boolean(lockedKey && !visibleNodeIds.has(lockedKey));
    if (!selectedMissing && !lockedMissing) return;
    clearSelection();
  }, [clearSelection, graphData.nodes, lockedKey, selectedKey]);

  // Transient hover is rendered entirely inside the scene. Promoting it into
  // React state mounted the inspector and re-rendered this large controller on
  // every hover transition, which made a lightweight highlight feel like a
  // mode change. Click/keyboard selection still owns the persistent inspector.
  const handleSceneHover = React.useCallback(() => undefined, []);

  React.useEffect(() => {
    if (!interactive || !manifest || !webglAvailable) return;
    const frame = window.requestAnimationFrame(() => {
      focusOverview();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOverview, interactive, manifest, webglAvailable]);

  React.useEffect(() => {
    if (interactive) return;
    resetUniversePresentation();
    graphRef.current?.pause();
    expandAbortRef.current?.abort();
    timelineAbortRef.current?.abort();
    if (snapshotReloadTimerRef.current !== null) {
      window.clearTimeout(snapshotReloadTimerRef.current);
      snapshotReloadTimerRef.current = null;
    }
    rebuildAbortRef.current?.abort();
    clearCameraSchedule();
    clearTimelineSettle();
  }, [clearCameraSchedule, clearTimelineSettle, interactive, resetUniversePresentation]);

  React.useEffect(() => {
    if (!viewportLoadProgress) return;
    if (!viewportLoadProgress.allDone) {
      completedSourcesRef.current.delete(viewportLoadProgress.sourceId);
      return;
    }
    if (viewportLoadProgress.loading) return;
    if (completedSourcesRef.current.has(viewportLoadProgress.sourceId)) return;
    completedSourcesRef.current.add(viewportLoadProgress.sourceId);
    setMoreHint(
      t("loadProgress.sourceComplete", {
        source: viewportLoadProgress.label,
        events: viewportLoadProgress.events.loaded,
        entities: viewportLoadProgress.entities.loaded,
      }),
    );
  }, [t, viewportLoadProgress]);

  React.useEffect(() => {
    const onVisibility = () => {
      const graph = graphRef.current;
      if (!graph) return;
      if (interactive && document.visibilityState === "visible") graph.resume();
      else graph.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [interactive]);

  React.useEffect(
    () => () => {
      expandAbortRef.current?.abort();
      expansionCacheRef.current.clear();
      expansionInflightRef.current.clear();
      rebuildAbortRef.current?.abort();
      timelineAbortRef.current?.abort();
      if (snapshotReloadTimerRef.current !== null) {
        window.clearTimeout(snapshotReloadTimerRef.current);
        snapshotReloadTimerRef.current = null;
      }
      snapshotReloadAttemptsRef.current.clear();
      clearCameraSchedule();
      clearTimelineSettle();
    },
    [clearCameraSchedule, clearTimelineSettle],
  );

  const rebuild = React.useCallback(async () => {
    if (!interactiveRef.current) return;
    rebuildAbortRef.current?.abort();
    const controller = new AbortController();
    rebuildAbortRef.current = controller;
    setRebuilding(true);
    setError("");
    try {
      const queued = await api.rebuildUniverse(controller.signal);
      if (controller.signal.aborted || !interactiveRef.current) return;
      setMoreHint(t("rebuild.queued"));
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await waitForAbortableDelay(750, controller.signal);
        if (controller.signal.aborted || !interactiveRef.current) return;
        const job = await api.getJob(queued.id, controller.signal);
        if (job.status === "failed") {
          throw new ApiError(0, "rebuild_failed", job.error || t("rebuild.failed"));
        }
        if (job.status !== "succeeded") continue;
        setManifest(await api.universeManifest());
        setMoreHint(t("rebuild.complete"));
        return;
      }
      throw new ApiError(0, "rebuild_timeout", t("rebuild.timeout"));
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "aborted") return;
      setError(reason instanceof ApiError ? reason.message : t("rebuild.failed"));
    } finally {
      if (rebuildAbortRef.current === controller) {
        rebuildAbortRef.current = null;
        setRebuilding(false);
      }
    }
  }, [t]);

  React.useEffect(() => {
    if (
      !interactive
      || !manifest?.stale
      || manifest.status !== "stale"
      || autoRebuildAttemptedRef.current
    ) return;
    autoRebuildAttemptedRef.current = true;
    void rebuild();
  }, [interactive, manifest, rebuild]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "sag-knowledge-universe absolute inset-0 z-[2] origin-center overflow-hidden transition-[opacity,transform] duration-200 ease-out",
        interactive
          ? "scale-100 opacity-100"
          : "pointer-events-none scale-[0.985] opacity-0",
      )}
      aria-label={t("aria")}
      aria-hidden={!interactive}
      data-universe-suspended={!interactive}
      data-universe-mode={interactive ? "explore" : "normal"}
      data-universe-activation-origin={activationOrigin}
      data-universe-search-locked={activationOrigin === "search"}
      data-universe-engine={
        sceneUnavailableReason
        ?? (webglAvailable === true ? "ready" : webglAvailable === false ? "api-unavailable" : "probing")
      }
      data-universe-node-budget={budget.nodes}
      data-universe-projection-node-budget={timelineProjectionBudget.nodes}
      data-universe-resident-node-budget={residentBudget.nodes}
      data-universe-timeline-phase={timelineJourney.phase}
      data-universe-display-mode={displayModeState.mode}
      data-universe-visible-bundle-limit={bundleWindow.visibleEventBundles}
      data-universe-transition-headroom={timelineWindowPlan.transitionHeadroomPackages}
      data-universe-visible-bundles={timelineWindow?.visibleBundleIds.length ?? 0}
      data-universe-cached-bundles={timelineWindow?.cacheBundleIds.length ?? 0}
    >
      {webglAvailable === true && sceneUnavailableReason === null && manifest ? (
        <div className="sag-universe-graph absolute inset-0">
          <UniverseScene
            key={`universe-scene:${sceneAttempt}`}
            ref={graphRef}
            data={graphData}
            policy={manifest.policy}
            sourceHits={sourceHits}
            selectedId={selectedKey}
            darkTheme={darkTheme}
            interactive={interactive}
            reducedMotion={Boolean(reducedMotion)}
            viewPreferences={viewPreferences}
            timelineJourney={timelineJourney}
            onNodeClick={handleNodeClick}
            onHover={handleSceneHover}
            onTimelineIntent={handleTimelineIntent}
            onCameraInteraction={restoreNormalPresentation}
            onViewChange={handleSceneViewChange}
            onSourceLod={handleSourceLod}
            onSelectionClear={clearSelection}
            onUnavailable={handleSceneUnavailable}
          />
        </div>
      ) : webglAvailable === false || sceneUnavailableReason !== null ? (
        <div className="absolute inset-0 grid place-items-center p-8">
          <div className="max-w-sm rounded-lg border border-border/70 bg-background/75 p-5 text-center shadow-soft backdrop-blur-md">
            <p className="text-sm font-medium">
              {t(
                sceneUnavailableReason === "context-disabled"
                  ? "webgl.contextDisabledTitle"
                  : sceneUnavailableReason === "context-creation"
                    ? "webgl.contextCreationTitle"
                    : sceneUnavailableReason === "dynamic-import"
                      ? "webgl.moduleTitle"
                      : sceneUnavailableReason
                        ? "webgl.sceneTitle"
                        : "webgl.title",
              )}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {t(
                sceneUnavailableReason === "context-lost"
                  ? "webgl.contextLostDescription"
                  : sceneUnavailableReason === "context-disabled"
                    ? "webgl.contextDisabledDescription"
                    : sceneUnavailableReason === "context-creation"
                      ? "webgl.contextCreationDescription"
                      : sceneUnavailableReason === "dynamic-import"
                        ? "webgl.moduleDescription"
                        : sceneUnavailableReason
                          ? "webgl.sceneDescription"
                          : "webgl.description",
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={retryScene}
            >
              <RefreshCw className="size-3.5" />
              {t("webgl.retry")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-col items-start gap-2 sm:left-5 sm:top-5">
        <div
          data-universe-summary="true"
          className="flex max-w-[calc(100vw-4.75rem)] items-center gap-2 overflow-hidden rounded-md border border-border/60 bg-background/62 px-2.5 py-2 text-[11px] text-muted-foreground shadow-soft backdrop-blur-md sm:gap-3 sm:px-3"
        >
          <AnimatePresence initial={false} mode="wait">
            {viewportSource ? (
              <motion.div
                key={`detail:${viewportSource.source_id}`}
                className="flex min-w-0 items-center gap-2"
                initial={reducedMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 3 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.18,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_rgb(103_232_249_/_0.65)]" />
                <span
                  className="min-w-0 max-w-72 truncate font-medium text-foreground/90"
                  title={viewportSource.label}
                >
                  {viewportSource.label}
                </span>
                <span
                  className="min-w-0 max-w-52 truncate border-l border-border/70 pl-2 tabular-nums sm:pl-3"
                  title={manifest?.version
                    ? t("stats.source", { events: viewportSource.event_count, entities: viewportSource.entity_count })
                    : t("stats.sourceBuilding", { events: viewportSource.event_count })}
                >
                  {manifest?.version
                    ? t("stats.source", {
                        events: compactCount(viewportSource.event_count, locale),
                        entities: compactCount(viewportSource.entity_count, locale),
                      })
                    : t("stats.sourceBuilding", {
                        events: compactCount(viewportSource.event_count, locale),
                      })}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="overview"
                className="flex min-w-0 items-center gap-2 sm:gap-3"
                initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.18,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <CircleDot className="size-3.5 text-cyan-200" />
                  <span className="hidden sm:inline">{t("legend.entities")}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <Sparkles className="size-3.5 text-amber-300" />
                  <span className="hidden sm:inline">{t("legend.events")}</span>
                </span>
                {summary ? (
                  <span className="min-w-0 max-w-64 truncate border-l border-border/70 pl-2 tabular-nums sm:pl-3" title={summary.query}>
                    {t("stats.result", visibleGraphCounts)}
                  </span>
                ) : manifest ? (
                  <span className="min-w-0 truncate border-l border-border/70 pl-2 tabular-nums sm:pl-3">
                    {manifest.version
                      ? t("stats.overview", {
                          sources: manifest.counts.sources ?? 0,
                          entities: compactCount(manifest.counts.entities ?? 0, locale),
                          events: compactCount(manifest.counts.events ?? 0, locale),
                        })
                      : t("stats.overviewBuilding", {
                          sources: manifest.counts.sources ?? 0,
                          events: compactCount(manifest.counts.events ?? 0, locale),
                        })}
                    {(manifest.counts.sources ?? 0) > renderedSourcePartitions.length
                      ? t("stats.visibleContours", { count: renderedSourcePartitions.length })
                      : ""}
                  </span>
                ) : null}
                {(manifest?.status === "failed" || manifest?.stale || manifest?.status === "building") && (
                  <TooltipProvider delayDuration={220}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            manifest.status === "failed"
                              ? "bg-rose-400 shadow-[0_0_8px_rgb(251_113_133_/_0.5)]"
                              : "bg-amber-300 shadow-[0_0_8px_rgb(252_211_77_/_0.45)]",
                          )}
                          role="status"
                          aria-label={manifest.status === "failed"
                            ? t("rebuild.failed")
                            : manifest.status === "building" || rebuilding
                              ? t("rebuild.running")
                              : t("rebuild.ready")}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {manifest.status === "failed"
                          ? t("rebuild.failed")
                          : manifest.status === "building" || rebuilding
                            ? t("rebuild.running")
                            : t("rebuild.ready")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {expandingKey && <Loader2 className="size-3 animate-spin" />}
          {activationOrigin === "search" && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-1 text-[9px] text-amber-700 dark:text-amber-300"
              title={t("searchLocked.description")}
            >
              <LockKeyhole className="size-2.5" />
              <span className="hidden sm:inline">{t("searchLocked.label")}</span>
            </span>
          )}
        </div>

        <AnimatePresence initial={false}>
          {interactive && viewportLoadProgress && (
            <UniverseLoadProgressPanel
              key={viewportLoadProgress.sourceId}
              progress={viewportLoadProgress}
              reducedMotion={Boolean(reducedMotion)}
              explicitOnly={activationOrigin !== "browse"}
            />
          )}
        </AnimatePresence>
      </div>

      {(moreHint || error) && (
        <div className={cn(
          "pointer-events-none absolute bottom-5 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-md border border-border/60 bg-background/72 px-3 py-2 text-[11px] text-muted-foreground shadow-soft backdrop-blur-md",
          timelineJourney.enabled && "bottom-20",
          inspectorNode && viewportSource && "bottom-44",
        )} role="status" aria-live="polite">
          {error || moreHint}
        </div>
      )}

      {interactive && inspectorNode && viewportSource && (
        <TooltipProvider delayDuration={180}>
          <div
            data-universe-inspector="true"
            className="absolute bottom-48 left-4 z-20 w-[min(360px,calc(100vw-5.5rem))] rounded-md border border-border/70 bg-background/90 p-3 shadow-soft backdrop-blur-xl sm:bottom-5 sm:left-6"
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  inspectorNode.kind === "entity"
                    ? "bg-cyan-300 shadow-[0_0_10px_rgb(103_232_249_/_0.75)]"
                    : "bg-amber-300 shadow-[0_0_10px_rgb(252_211_77_/_0.75)]",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {t("inspector.lockedNetwork")}
                  <span className="sr-only">：{inspectorNode.label}</span>
                </p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {t("inspector.blankToUnlock")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => dispatchUniverseDetail(
                        inspectorNode.kind,
                        inspectorNode.rawId,
                        inspectorNode.sourceId,
                      )}
                      aria-label={t("inspector.viewSource")}
                    >
                      <Info className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("inspector.viewSource")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => dispatchUniverseAsk(inspectorNode)}
                      aria-label={t("inspector.ask")}
                    >
                      <MessageCircleQuestion className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("inspector.ask")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={clearSelection}
                      aria-label={t("inspector.clear")}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("inspector.clear")}</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/70">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    inspectorNode.kind === "entity" ? "bg-cyan-400/75" : "bg-amber-400/75",
                  )}
                  style={{
                    width: `${inspectorTotalKnown && inspectorTotal > 0
                      ? Math.min(100, Math.max(3, inspectorProgress / inspectorTotal * 100))
                      : inspectorProgress > 0 ? 35 : 0}%`,
                  }}
                />
              </div>
              <span className="shrink-0 tabular-nums">
                {inspectorProgress} / {inspectorTotalKnown ? inspectorTotal : "?"}
              </span>
            </div>
            <div className="mt-2 flex min-h-7 items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[10px] text-muted-foreground">
                {expandingKey === inspectorNode.id
                  ? t("inspector.expanding")
                  : inspectorCanExpand
                    ? inspectorTotalKnown
                      ? t("inspector.remaining", { count: inspectorRemaining ?? 0 })
                      : t("inspector.clickExplore")
                    : inspectorExhausted && (inspectorRemaining ?? 0) > 0
                      ? t("inspector.rangeStart")
                    : inspectorTotal > 0
                      ? t("inspector.allVisible")
                      : t("inspector.none")}
              </p>
              {inspectorCanExpand && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 border-border/70 bg-background/70 px-2.5 text-[10px] shadow-none"
                  onClick={() => void expandNode(inspectorNode)}
                  disabled={expandingKey === inspectorNode.id}
                >
                  {expandingKey === inspectorNode.id
                    ? <Loader2 className="size-3 animate-spin" />
                    : <GitBranch className="size-3" />}
                  {t("inspector.exploreMore")}
                </Button>
              )}
            </div>
          </div>
        </TooltipProvider>
      )}

      {(loading || webglAvailable === null) && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {timelineControlsVisible && (
        <TooltipProvider delayDuration={200}>
          <div
            className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/65 bg-background/76 p-1.5 shadow-soft backdrop-blur-xl"
            data-universe-timeline-controls="true"
          >
            <IconControl
              label={t("controls.previousTimePage")}
              onClick={() => void graphRef.current?.moveTimeline("previous")}
              disabled={!timelineJourney.hasPrevious
                || timelineJourney.phase === "loading"
                || timelineJourney.phase === "transitioning"}
            >
              <ChevronLeft className="size-3.5" />
            </IconControl>
            <span
              className={cn(
                "rounded-full px-2 py-1 text-[9px] font-medium",
                displayModeState.mode === "preview"
                  ? "bg-amber-400/12 text-amber-200"
                  : "bg-muted/55 text-muted-foreground",
              )}
              title={t(displayModeState.mode === "preview"
                ? "controls.previewModeHint"
                : "controls.normalModeHint")}
              data-universe-display-mode-indicator={displayModeState.mode}
            >
              {t(displayModeState.mode === "preview"
                ? "controls.previewMode"
                : "controls.normalMode")}
            </span>
            <span className="min-w-32 px-2 text-center text-[10px] tabular-nums text-muted-foreground">
              {t(timelineJourney.phase === "complete"
                ? "controls.completedTimePosition"
                : "controls.timePosition", {
                  time: visibleTimelineRange,
                })}
            </span>
            <IconControl
              label={t("controls.nextTimePage")}
              onClick={() => void graphRef.current?.moveTimeline("next")}
              disabled={!timelineJourney.hasNext
                || timelineJourney.phase === "loading"
                || timelineJourney.phase === "transitioning"}
            >
              <ChevronRight className="size-3.5" />
            </IconControl>
          </div>
        </TooltipProvider>
      )}

      {interactive && (
        <TooltipProvider delayDuration={240}>
          <div
            className="absolute bottom-5 right-5 z-10 flex flex-col gap-1.5"
            data-universe-controls="true"
          >
            <IconControl
              label={t("controls.currentResult")}
              onClick={focusResult}
              disabled={!summary && !selectedKey}
            >
              <LocateFixed className="size-3.5" />
            </IconControl>
            <IconControl label={t("controls.overview")} onClick={focusOverview} disabled={!manifest}>
              <Focus className="size-3.5" />
            </IconControl>
            <IconControl
              label={t("controls.reset")}
              onClick={() => resetScene(epochRef.current + 1)}
              disabled={!working.nodes.length}
            >
              <RotateCcw className="size-3.5" />
            </IconControl>
            <IconControl label={t("controls.refresh")} onClick={() => void rebuild()} disabled={rebuilding}>
              <RefreshCw className={cn("size-3.5", rebuilding && "animate-spin")} />
            </IconControl>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
