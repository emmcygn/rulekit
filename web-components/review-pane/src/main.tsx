/** Dev harness only. Not part of the component's public surface. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewQueue } from "./ReviewQueue.js";
import { DEMO_QUEUE } from "./demo.js";
import type { ProposedFactCard } from "./types.js";

function Harness() {
  const [items, setItems] = useState<ProposedFactCard[]>(DEMO_QUEUE);
  const [log, setLog] = useState<string[]>([]);

  // The host owns the write to facts.yaml; the component only reports the
  // decision. Here it just drops the card and logs what would be stamped.
  const decide = (item: ProposedFactCard, what: string) => {
    setLog((l) => [`${what} ${item.patient} ${item.fact} — reviewedBy: dev, reviewedAt: ${new Date().toISOString()}`, ...l]);
    setItems((cur) => cur.filter((c) => c.id !== item.id));
  };

  return (
    <>
      <ReviewQueue
        items={items}
        onConfirm={(i) => decide(i, "confirm")}
        onEdit={(i, v) => decide(i, `edit -> ${v}`)}
        onReject={(i) => decide(i, "reject")}
      />
      <pre style={{ font: "12px ui-monospace, monospace", color: "#6B655C", padding: "0 20px" }}>{log.join("\n")}</pre>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
