import { FlaskConical } from "lucide-react";

import { showSyntheticData } from "@insiderflow/db";

/**
 * Says so when an aggregate is including synthetic fixtures.
 *
 * Aggregate surfaces normally exclude the reserved `ZZ*` namespace, because a
 * fabricated trade must never be presented as market data. A locally seeded
 * stack contains nothing else, though, so `INSIDERFLOW_SHOW_SYNTHETIC=true`
 * lets docker compose show a working product instead of empty charts.
 *
 * The moment that switch is on, the page has to admit it. An unlabelled chart
 * built from fixtures is exactly the screenshot that gets mistaken for real
 * market data — which is the thing the whole ZZ* convention exists to prevent.
 *
 * Renders nothing in the default configuration.
 */
export function SyntheticDataNotice() {
  if (!showSyntheticData()) return null;
  return (
    <p
      role="status"
      data-testid="synthetic-notice"
      className="glass flex items-center gap-2 rounded-lg border border-amber-300/25 px-3 py-2 text-xs text-amber-200/90"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Includes synthetic seed data.</strong> This deployment has{" "}
        <code>INSIDERFLOW_SHOW_SYNTHETIC=true</code>, so fabricated <code>ZZ*</code> fixtures appear
        in these aggregates. Not market data.
      </span>
    </p>
  );
}
