import { cn } from "@/lib/utils";

/** Extensible market → flag map; unknown markets get a neutral globe. */
const FLAGS: Record<string, { emoji: string; label: string }> = {
  US: { emoji: "🇺🇸", label: "United States" },
  IN: { emoji: "🇮🇳", label: "India" },
  EU: { emoji: "🇪🇺", label: "European Union" },
  CA: { emoji: "🇨🇦", label: "Canada" },
};

export function CountryFlag({ country, className }: { country: string; className?: string }) {
  const entry = FLAGS[country.toUpperCase()] ?? { emoji: "🌐", label: country.toUpperCase() };
  return (
    <span role="img" aria-label={entry.label} title={entry.label} className={cn(className)}>
      {entry.emoji}
    </span>
  );
}
