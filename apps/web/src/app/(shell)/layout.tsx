import { Sidebar } from "@/components/shell/sidebar";

/** Data-dense app shell: fixed top bar (root layout) + sidebar + content well. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl pt-14">
      <Sidebar />
      <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-8">
        {children}
      </main>
    </div>
  );
}
