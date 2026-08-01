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
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-400">
          {openApiSpec.info.title} · v{openApiSpec.info.version}
        </p>
        <h1 className="text-4xl font-bold tracking-tight">API documentation</h1>
        <p className="max-w-2xl text-zinc-400">{openApiSpec.info.description}</p>
        <p className="text-sm text-zinc-500">
          Machine-readable spec:{" "}
          <a href="/api/openapi.json" className="text-emerald-400 underline underline-offset-4">
            /api/openapi.json
          </a>
        </p>
      </header>

      <section className="flex flex-col gap-8">
        {paths.map(([path, methods]) => {
          const op = methods.get;
          if (!op) return null;
          return (
            <article
              key={path}
              className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-xs font-bold text-emerald-400">
                  GET
                </span>
                <code className="font-mono text-sm">{path}</code>
              </div>
              <h2 className="font-semibold">{op.summary}</h2>
              {op.description ? (
                <p className="text-sm leading-relaxed text-zinc-400">{op.description}</p>
              ) : null}
              {op.parameters && op.parameters.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
                        <th className="py-1.5 pr-4">Param</th>
                        <th className="py-1.5 pr-4">In</th>
                        <th className="py-1.5 pr-4">Type</th>
                        <th className="py-1.5">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {op.parameters.map((p) => (
                        <tr key={p.name} className="border-b border-zinc-800/50 align-top">
                          <td className="py-1.5 pr-4 font-mono text-emerald-300">
                            {p.name}
                            {p.required ? "*" : ""}
                          </td>
                          <td className="py-1.5 pr-4 text-zinc-500">{p.in}</td>
                          <td className="py-1.5 pr-4 font-mono text-xs text-zinc-400">
                            {paramType(p)}
                          </td>
                          <td className="py-1.5 text-zinc-400">{p.description}</td>
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

      <footer className="border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-500">
        Public tier: 60 requests/min per IP. Send <code className="font-mono">x-api-key</code> for
        600/min. All data is for research and education only — not investment advice.
      </footer>
    </main>
  );
}
