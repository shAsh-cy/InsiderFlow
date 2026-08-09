import { describe, expect, it, vi } from "vitest";

import { activateWhenReady, INTERACTION_EVENTS, type ActivationHost } from "./activation";

/** A window-shaped double: no DOM, no React, no timers of its own. */
function fakeHost(options: { idle?: boolean } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const idleCallbacks = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let next = 1;

  const host: ActivationHost & {
    dispatch(type: string): void;
    runIdle(): void;
    runTimers(): void;
    listenerCount(): number;
    pending(): { idle: number; timers: number };
  } = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
    setTimeout(handler) {
      const id = next++;
      timers.set(id, handler);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    runIdle() {
      for (const cb of [...idleCallbacks.values()]) cb();
    },
    runTimers() {
      for (const cb of [...timers.values()]) cb();
    },
    listenerCount() {
      return [...listeners.values()].reduce((n, l) => n + l.length, 0);
    },
    pending() {
      return { idle: idleCallbacks.size, timers: timers.size };
    },
  };

  if (options.idle !== false) {
    host.requestIdleCallback = (callback) => {
      const id = next++;
      idleCallbacks.set(id, callback);
      return id;
    };
    host.cancelIdleCallback = (handle) => {
      idleCallbacks.delete(handle);
    };
  }

  return host;
}

describe("activateWhenReady", () => {
  it("starts on the browser's idle moment", () => {
    const host = fakeHost();
    const onReady = vi.fn();
    activateWhenReady(host, 1500, onReady);

    expect(onReady).not.toHaveBeenCalled();
    host.runIdle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  for (const event of INTERACTION_EVENTS) {
    it(`starts on the reader's first ${event}, without waiting for idle`, () => {
      const host = fakeHost();
      const onReady = vi.fn();
      activateWhenReady(host, 1500, onReady);

      host.dispatch(event);
      expect(onReady, `${event} should start the work`).toHaveBeenCalledTimes(1);
      // The idle callback that never got its turn must be cancelled, or it
      // fires later into work that has already begun.
      expect(host.pending().idle, "idle callback left pending").toBe(0);
      expect(host.listenerCount(), "interaction listeners left attached").toBe(0);
    });
  }

  it("fires exactly once however many triggers arrive", () => {
    const host = fakeHost();
    const onReady = vi.fn();
    activateWhenReady(host, 1500, onReady);

    host.dispatch("scroll");
    host.dispatch("pointerdown");
    host.runIdle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timer where requestIdleCallback does not exist", () => {
    // Safari, at time of writing. Same promise, worse guarantee.
    const host = fakeHost({ idle: false });
    const onReady = vi.fn();
    activateWhenReady(host, 1500, onReady);

    expect(host.pending().timers, "a fallback timer was scheduled").toBe(1);
    host.runTimers();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("cleans up everything when torn down before anything fires", () => {
    const host = fakeHost();
    const onReady = vi.fn();
    const cancel = activateWhenReady(host, 1500, onReady);

    cancel();
    expect(host.listenerCount()).toBe(0);
    expect(host.pending()).toEqual({ idle: 0, timers: 0 });

    // …and a trigger that arrives after teardown does nothing.
    host.dispatch("scroll");
    host.runIdle();
    expect(onReady).not.toHaveBeenCalled();
  });
});
