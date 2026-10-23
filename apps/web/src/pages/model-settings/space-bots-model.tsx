import { Plural, Trans } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useCallback, useEffect, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

/** Bots that pick their own model ignore the space model and its changes. */
export function botsWithOwnModel<T extends Pick<Bot, "modelProvider" | "modelId">>(
  bots: readonly T[],
): T[] {
  return bots.filter((bot) => Boolean(bot.modelProvider && bot.modelId));
}

/**
 * Tells the owner which bots ignore the space model and moves them all onto it in
 * one step, so a space-wide switch (for example after a subscription runs out)
 * does not mean opening every bot.
 */
export function SpaceBotsModelNotice({ refreshKey }: { refreshKey?: unknown }) {
  const rpc = useSpaceRpc();
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<number | null>(null);

  const load = useCallback(() => {
    void rpc.bots
      .list()
      .then(setBots)
      .catch(() => setBots(null));
  }, [rpc]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const pinned = bots ? botsWithOwnModel(bots) : [];

  async function switchAllToSpaceModel() {
    setPending(true);
    setError(null);
    setMoved(null);
    let done = 0;
    try {
      for (const bot of pinned) {
        await rpc.bots.update({
          botId: bot.id,
          modelProvider: null,
          modelId: null,
          thinkingLevel: null,
        });
        done += 1;
      }
      setMoved(done);
    } catch (cause) {
      setError(errorText(cause));
      if (done) setMoved(done);
    } finally {
      setPending(false);
      load();
    }
  }

  if (!bots || (pinned.length === 0 && moved === null && !error)) return null;

  return (
    <div className="mt-6 border-t border-border pt-5" data-testid="space-bots-model">
      <div className="text-[13.5px] text-foreground">
        <Trans>Bots in this space</Trans>
      </div>
      {pinned.length ? (
        <>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
            <Plural
              value={pinned.length}
              one="# bot picks its own model, so it ignores the space model:"
              other="# bots pick their own model, so they ignore the space model:"
            />{" "}
            <span className="text-foreground">{pinned.map((bot) => bot.name).join(", ")}</span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 rounded-full"
            disabled={pending}
            onClick={() => void switchAllToSpaceModel()}
          >
            {pending ? (
              <Trans>Switching bots…</Trans>
            ) : (
              <Plural
                value={pinned.length}
                one="Use the space model for this bot"
                other="Use the space model for all # bots"
              />
            )}
          </Button>
        </>
      ) : null}
      {moved ? (
        <p className="mt-2 text-[13px] leading-[1.5] text-success" role="status">
          <Plural
            value={moved}
            one="# bot now follows the space model."
            other="# bots now follow the space model."
          />
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[13px] leading-[1.5] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
