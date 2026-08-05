import { SiteFooter } from "@/components/shell/site-footer";
import { Sidebar } from "@/components/shell/sidebar";

/** Data-dense app shell: fixed top bar (root layout) + sidebar + content well. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col pt-14">
      <div className="flex">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-8">
          {children}
        </main>
      </div>
      {/* Every page carries the disclaimer — any page can be an entry point. */}
      <SiteFooter />
    </div>
  );
}
