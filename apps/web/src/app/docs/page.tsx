import type { Metadata } from "next";

import { openApiSpec } from "@/lib/api/openapi";

export const metadata: Metadata = {
  title: "InsiderFlow API docs",
  description: "Free, public, rate-limited API for normalized insider-trading data.",
};

interface ParamDoc {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  schema?: { type?: string; enum?: readonly string[]; default?: unknown; format?: string };
}

interface OperationDoc {
  summary?: string;
  description?: string;
  parameters?: readonly ParamDoc[];
}

function paramType(p: ParamDoc): string {
  if (p.schema?.enum) return p.schema.enum.join(" | ");
  return `${p.schema?.type ?? "string"}${p.schema?.format ? ` (${p.schema.format})` : ""}`;
}

export default function DocsPage() {
  const paths = Object.entries(openApiSpec.paths as Record<string, { get?: OperationDoc }>);

  return (
    <main id="main" className="shell-gutter pt-20 pb-24">
      {/* Left-anchored, like every other page in the product. The measure
          keeps the prose readable by trimming the right-hand side; it does
          not move the left edge. */}
      <div data-content-region className="flex max-w-[60rem] flex-col gap-10">
        <header className="rail-bleed flex flex-col gap-3 border-b border-border pb-8">
          <p className="text-2xs font-semibold text-ink-faint">
            {openApiSpec.info.title} · v<span className="num">{openApiSpec.info.version}</span>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">API documentation</h1>
          <p className="max-w-[68ch] text-base leading-relaxed text-ink-muted">
            {openApiSpec.info.description}
          </p>
          <p className="text-sm text-ink-muted">
            Machine-readable spec:{" "}
            <a
              href="/api/openapi.json"
              className="cursor-pointer font-mono text-ink underline decoration-border underline-offset-4 transition-colors hover:decoration-ink"
            >
              /api/openapi.json
            </a>
          </p>
        </header>

        <section className="flex flex-col gap-6">
          {paths.map(([path, methods]) => {
            const op = methods.get;
            if (!op) return null;
            return (
              <article key={path} className="surface flex flex-col gap-3 rounded-lg p-5">
                <div className="flex flex-wrap items-baseline gap-3">
                  {/* Rectangular: a method marker labels the endpoint, it does
                    not do anything when you press it. */}
                  <span className="rounded-sm border border-border bg-fill px-1.5 py-0.5 font-mono text-2xs font-semibold text-ink">
                    GET
                  </span>
                  <code className="font-mono text-sm text-ink">{path}</code>
                </div>
                <h2 className="text-base font-semibold text-ink">{op.summary}</h2>
                {op.description ? (
                  <p className="max-w-[68ch] text-sm leading-relaxed text-ink-muted">
                    {op.description}
                  </p>
                ) : null}
                {op.parameters && op.parameters.length > 0 ? (
                  /* Negative margin so the zebra bands bleed to the text edge
                   rather than sitting inset inside the card's padding. */
                  <div className="-mx-2 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-2xs text-ink-faint">
                          <th className="px-2 pb-1.5 font-medium">Param</th>
                          <th className="px-2 pb-1.5 font-medium">In</th>
                          <th className="px-2 pb-1.5 font-medium">Type</th>
                          <th className="px-2 pb-1.5 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {op.parameters.map((p) => (
                          <tr
                            key={p.name}
                            className="border-b border-border align-top last:border-0 even:bg-fill/55"
                          >
                            <td className="px-2 py-1.5 font-mono text-xs text-ink">
                              {p.name}
                              {p.required ? "*" : ""}
                            </td>
                            <td className="px-2 py-1.5 text-xs text-ink-faint">{p.in}</td>
                            <td className="px-2 py-1.5 font-mono text-xs text-ink-muted">
                              {paramType(p)}
                            </td>
                            <td className="px-2 py-1.5 text-xs text-ink-muted">{p.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        <footer className="border-t border-border pt-6 text-xs leading-relaxed text-ink-faint">
          Public tier: <span className="num">60</span> requests/min per IP. Send{" "}
          <code className="font-mono text-ink-muted">x-api-key</code> for{" "}
          <span className="num">600</span>/min. All data is for research and education only — not
          investment advice.
        </footer>
      </div>
    </main>
  );
}
