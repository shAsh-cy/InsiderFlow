import { SiteFooter } from "@/components/shell/site-footer";
import { Sidebar } from "@/components/shell/sidebar";

/**
 * Data-dense app shell: fixed top bar (root layout) + sidebar + content well.
 *
 * LAYOUT v3. The chrome pins to the viewport and the content is fluid — see
 * the contract at the top of globals.css. There is no frame here and no cap:
 * the sidebar's left edge is the screen's left edge, and the content region
 * runs from the sidebar to the far gutter.
 *
 * r4 centred this whole row at 88rem, which centred the CHROME along with
 * it: at 1920 the sidebar floated 250px in from the bezel and the app read
 * as an island on a desktop rather than as the window it is. r3 had the
 * opposite failure — everything pinned left, dead paper down the right. The
 * two things want opposite treatment, so they get it.
 *
 * `data-content-region` marks the well for the layout spec, which asserts
 * that every top-level block on every app page starts on the same x and that
 * the region reaches the far gutter.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col pt-14">
      <div className="flex">
        <Sidebar />
        {/* `min-w-0` is load-bearing: without it a wide table sets this
            column's min-content width and pushes the page sideways instead
            of scrolling inside its own well. */}
        <main id="main" className="shell-content min-w-0 flex-1 py-8">
          <div data-content-region>{children}</div>
        </main>
      </div>
      {/* Every page carries the disclaimer — any page can be an entry point. */}
      <SiteFooter />
    </div>
  );
}
