import { Trans, useLingui } from "@lingui/react/macro";
import type { RoutineHistory } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { rpc } from "../lib/rpc";
import { formatToolActivityDuration } from "../lib/tool-activity-view";
import { statusLabel, statusTone } from "./ActivityList";

export function RoutineRunHistory({ routineId }: { routineId: string }) {
  const { i18n } = useLingui();
  const [history, setHistory] = useState<RoutineHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const expandedRef = useRef(false);
  const hasOlderPages = useRef(false);
  const listId = useId();
  const runs = history?.runs ?? null;

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    generation.current += 1;
    setHistory(null);
    setFailed(false);
    setLoadingMore(false);
    hasOlderPages.current = false;
    async function refresh() {
      try {
        if (expandedRef.current && historyLoaded) return;
        const page = await rpc.routines.history({ routineId });
        if (cancelled) return;
        historyLoaded = true;
        setHistory((current) =>
          current && hasOlderPages.current
            ? {
                runs: [
                  ...page.runs,
                  ...current.runs.filter((run) => !page.runs.some((fresh) => fresh.id === run.id)),
                ],
                nextCursor: current.nextCursor,
              }
            : page,
        );
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        // Keep older pages stable while browsing. Refresh is explicit in the expanded view.
        if (!cancelled) timer = window.setTimeout(() => void refresh(), 15_000);
      }
    }
    let historyLoaded = false;
    void refresh();
    return () => {
      cancelled = true;
      generation.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [routineId, revision]);

  async function loadMore() {
    if (!history?.nextCursor || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    try {
      const page = await rpc.routines.history({ routineId, before: history.nextCursor });
      if (request !== generation.current) return;
      hasOlderPages.current = true;
      setHistory((current) =>
        current
          ? {
              runs: [
                ...current.runs,
                ...page.runs.filter(
                  (run) => !current.runs.some((existing) => existing.id === run.id),
                ),
              ],
              nextCursor: page.nextCursor,
            }
          : current,
      );
      setFailed(false);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }

  return (
    <section data-testid="routine-run-history" className="mt-8 text-sm text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <h3>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-2 hover:text-foreground"
          >
            <Trans>Run history</Trans>
            <ChevronDown size={14} aria-hidden className={expanded ? "rotate-180" : undefined} />
          </button>
        </h3>
        {expanded ? (
          <Button size="xs" variant="ghost" onClick={() => setRevision((value) => value + 1)}>
            <Trans>Refresh</Trans>
          </Button>
        ) : null}
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-[13.5px] text-destructive">
          <Trans>Could not load run history</Trans>
        </p>
      ) : runs === null ? (
        <p role="status" className="mt-2 text-[13.5px]">
          <Trans>Loading…</Trans>
        </p>
      ) : runs.length === 0 ? (
        <p className="mt-2 text-[13.5px]">
          <Trans>No runs yet</Trans>
        </p>
      ) : null}
      {runs && runs.length > 0 ? (
        <ul id={listId} className="mt-2 divide-y divide-border">
          {(expanded ? runs : runs.slice(0, 1)).map((run) => {
            const at = run.startedAt ?? run.createdAt;
            const duration =
              run.startedAt && run.completedAt
                ? formatToolActivityDuration(
                    Date.parse(run.completedAt) - Date.parse(run.startedAt),
                  )
                : null;
            return (
              <li key={run.id} className="py-2.5 text-[13px]" data-testid="routine-run-row">
                <div className="flex items-center justify-between gap-2">
                  <time dateTime={at} title={new Date(at).toLocaleString(i18n.locale || "en")}>
                    {new Date(at).toLocaleString(i18n.locale || "en", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <span className={statusTone(run.status)}>{statusLabel(run.status)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span>{duration}</span>
                  {run.messageId ? (
                    <Link
                      to={`${run.groupId ? `/app/g/${encodeURIComponent(run.groupId)}` : `/app/${encodeURIComponent(run.botId)}`}?m=${encodeURIComponent(run.messageId)}`}
                      className="text-foreground underline underline-offset-2"
                    >
                      <Trans>View chat</Trans>
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {expanded && history?.nextCursor ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="mt-2"
        >
          <Trans>Load older runs</Trans>
        </Button>
      ) : null}
    </section>
  );
}
