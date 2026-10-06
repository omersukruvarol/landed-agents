import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api";
import { LoopCard } from "../components/LoopCard";
import { Empty, ErrorBox, Loading, PageTitle, Segmented } from "../components/ui";
import { useI18n } from "../i18n";
import type { Loop } from "../types";

type State = "open" | "dismissed" | "resolved";

/** To do: every open loop as a plain-language card with its next step. */
export function LoopsPage() {
  const { t } = useI18n();
  const [state, setState] = useState<State>("open");
  const loops = useQuery({
    queryKey: ["loops", state],
    queryFn: () => get<Loop[]>(`/v1/loops?state=${state}`),
  });
  const tabs = (["open", "dismissed", "resolved"] as const).map(
    (s) => [t.todoPage.tabs[s] as string, s] as const,
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title={t.todoPage.title} subtitle={t.todoPage.subtitle} />
        <Segmented value={state} options={tabs} onChange={setState} />
      </div>
      {loops.isLoading && <Loading />}
      {loops.error && <ErrorBox error={loops.error} />}
      {loops.data && loops.data.length === 0 && <Empty title={t.todoPage.empty[state] as string} />}
      <div className="space-y-3">
        {(loops.data ?? []).map((l) => (
          <LoopCard key={l.id} loop={l} />
        ))}
      </div>
    </div>
  );
}
