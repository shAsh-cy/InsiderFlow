import { SiteFooter } from "@/components/shell/site-footer";
import { Sidebar } from "@/components/shell/sidebar";

/**
 * Data-dense app shell: fixed top bar (root layout) + sidebar + content well.
 *
 * The FRAME is centred and capped at `--shell-max`; the CONTENT inside it is
 * not. That distinction is the whole of r4's Step 1 and it is worth stating
 * twice: `margin-inline: auto` on `.shell-frame` is required, and
 * `margin-inline: auto` on anything inside `[data-content-region]` is still
 * forbidden. Bounding the frame gives r3's real prize — a left edge that
 * stops moving once the window is wider than the design — without the
 * left-bezel hug and the dead right-hand strip that pinning it to x=0 caused.
 *
 * `data-content-region` marks the well for the layout spec, which asserts
 * that every top-level block on every app page starts on exactly the same x;
 * `data-shell-frame` marks the boundary above which centring is legal.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col pt-14">
      <div data-shell-frame className="shell-frame flex">
        <Sidebar />
        {/* `min-w-0` is load-bearing: without it a wide table sets this
            column's min-content width and pushes the whole frame past the
            viewport instead of scrolling inside its own well. */}
        <main id="main" className="shell-content min-w-0 flex-1 py-8">
          <div data-content-region>{children}</div>
        </main>
      </div>
      {/* Every page carries the disclaimer — any page can be an entry point. */}
      <SiteFooter />
    </div>
  );
}
