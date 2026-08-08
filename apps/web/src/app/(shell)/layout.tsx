import { SiteFooter } from "@/components/shell/site-footer";
import { Sidebar } from "@/components/shell/sidebar";

/**
 * Data-dense app shell: fixed top bar (root layout) + sidebar + content well.
 *
 * The shell is full-bleed and the content well is left-anchored inside it.
 * There is no `mx-auto` here on purpose: a centred well moves its left edge
 * every time the window is resized, and every page in this product is a
 * column you scan down. The readability limit lives on `.shell-measure`,
 * which trims the right-hand side only.
 *
 * `data-content-region` marks the well for the layout spec, which asserts
 * that the first element of every app page starts on exactly the same x.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col pt-14">
      <div className="flex">
        <Sidebar />
        <main id="main" className="shell-gutter min-w-0 flex-1 py-8">
          <div data-content-region className="shell-measure">
            {children}
          </div>
        </main>
      </div>
      {/* Every page carries the disclaimer — any page can be an entry point. */}
      <SiteFooter />
    </div>
  );
}
