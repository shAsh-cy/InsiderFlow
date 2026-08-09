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
 * r6 amendment: the sidebar rises to y=0 and carries the brand, and the
 * masthead starts at the sidebar's right edge. The application now has one
 * left edge instead of two — the brand no longer sits at the bezel above a
 * page that starts at the content gutter.
 *
 * `data-app-shell` is how the masthead knows which shell it is drawing for.
 * It is read in CSS, from the layout that is actually rendered, rather than
 * from a list of pathnames somebody has to remember to extend.
 *
 * `data-content-region` marks the well for the layout spec, which asserts
 * that every top-level block on every app page starts on the same x and that
 * the region reaches the far gutter.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-app-shell className="flex flex-col">
      <div className="flex">
        <Sidebar />
        {/* `min-w-0` is load-bearing: without it a wide table sets this
            column's min-content width and pushes the page sideways instead
            of scrolling inside its own well.

            `pt-22` = the masthead's 3.5rem plus the well's own 2rem. The
            offset moved off the wrapper and onto this column in r6: the
            sidebar has to start at the top of the viewport for the brand to
            sit in the corner of the window, and a wrapper-level `pt-14`
            would have pushed it down with everything else.

            `tabIndex={-1}` so the skip link's target can actually take
            focus — following a fragment to a non-focusable element moves the
            scroll position and leaves the keyboard where it was. */}
        <main id="main" tabIndex={-1} className="shell-content min-w-0 flex-1 pt-22 pb-8">
          <div data-content-region>{children}</div>
        </main>
      </div>
      {/* Every page carries the disclaimer — any page can be an entry point. */}
      <SiteFooter />
    </div>
  );
}
