// Unit test for lazyWithPreload. We mock a loader that tracks call
// count + resolves to a fake module; lazy() output is otherwise
// opaque without a React renderer, but .preload() is a direct call
// we can assert on.

import lazyWithPreload from "./lazyWithPreload.js";

describe("lazyWithPreload", () => {
  test("returns a component-like object with .preload()", () => {
    const loader = jest.fn(() => Promise.resolve({ default: () => null }));
    const C = lazyWithPreload(loader);
    expect(typeof C.preload).toBe("function");
  });

  test("preload() invokes the loader and returns its promise", async () => {
    const fakeModule = { default: () => null };
    const loader = jest.fn(() => Promise.resolve(fakeModule));
    const C = lazyWithPreload(loader);
    const p = C.preload();
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toBe(fakeModule);
  });

  test("preload() is safe to call multiple times", () => {
    const loader = jest.fn(() => Promise.resolve({ default: () => null }));
    const C = lazyWithPreload(loader);
    C.preload();
    C.preload();
    C.preload();
    // Each call re-invokes the loader; webpack's own cache dedupes the
    // network fetch. We just need to make sure nothing throws.
    expect(loader).toHaveBeenCalledTimes(3);
  });

  test("does not call loader eagerly at creation time", () => {
    const loader = jest.fn(() => Promise.resolve({ default: () => null }));
    lazyWithPreload(loader);
    expect(loader).not.toHaveBeenCalled();
  });
});
