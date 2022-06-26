// @vitest-environment jsdom

import { useResource } from "@starbeam/use-resource";
import { useState } from "react";
import { expect } from "vitest";

import { html, react } from "./support/dom.js";
import { entryPoint } from "./support/entry-point.js";
import { testStrictAndLoose } from "./support/modes.js";

testStrictAndLoose("useResource", (mode) => {
  TestResource.resetId();

  const result = mode
    .render(() => {
      const [count, setCount] = useState(0);

      const test = useResource((resource, count) => {
        const test = TestResource.initial(count);

        resource.on.update((count) => test.transition("updated", count));
        resource.on.layout(() => test.transition("layout"));
        resource.on.idle(() => test.transition("idle"));
        resource.on.cleanup(() => test.transition("unmounted"));

        return test;
      }, count);

      return {
        value: test,
        dom: react.fragment(
          html.p(test.state),
          html.p(count),
          html.label(
            html.span("Increment"),
            html.button({ onClick: () => setCount(count + 1) }, "++")
          )
        ),
      };
    })
    .expectStableValue()
    .expectHTML(
      (value) =>
        `<p>${value.state}</p><p>${value.count}</p><label><span>Increment</span><button>++</button></label>`
    );

  const resource = result.value;

  resource.assert(
    mode.match({
      // strict mode runs initial render twice
      strict: () => "updated",
      loose: () => "idle",
    }),
    0
  );

  result.rerender();
  resource.assert("updated", 0);

  result.find("button").fire.click();
  resource.assert("updated", 1);

  result.rerender();
  resource.assert("updated", 1);

  result.unmount();
  resource.assert("unmounted", 1);
});

testStrictAndLoose("useResource (nested)", (mode) => {
  TestResource.resetId();

  const result = mode
    .render(() => {
      const [count, setCount] = useState(0);

      const test = useResource((resource, count) => {
        const test = TestResource.initial(count);

        resource.on.update((count) => test.transition("updated", count));
        resource.on.layout(() => test.transition("layout"));
        resource.on.idle(() => test.transition("idle"));
        resource.on.cleanup(() => test.transition("unmounted"));

        return test;
      }, count);

      return {
        value: test,
        dom: react.fragment(
          react.render(ChildComponent, { count: test }),
          html.p(count),
          html.label(
            html.span("Increment"),
            html.button({ onClick: () => setCount(count + 1) }, "++")
          )
        ),
      };
    })
    .expectStableValue()
    .expectHTML(
      ({ state, count }) =>
        `<p>${state}</p><p>${count}</p><label><span>Increment</span><button>++</button></label>`
    );

  function ChildComponent({ count }: { count: TestResource }) {
    return html.p(count.state);
  }

  const resource = result.value;

  resource.assert(
    mode.match({
      strict: () => "updated",
      loose: () => "idle",
    }),
    0
  );

  result.rerender();
  resource.assert("updated", 0);

  result.find("button").fire.click();
  resource.assert("updated", 1);

  result.rerender();
  resource.assert("updated", 1);

  result.unmount();
  resource.assert("unmounted", 1);
});

testStrictAndLoose(
  "useResource (nested, stability across remounting)",
  (mode) => {
    TestResource.resetId();

    const result = mode
      .render(() => {
        const [count, setCount] = useState(0);

        const test = useResource((resource, count) => {
          const test = TestResource.initial(count);

          resource.on.update((count) => test.transition("updated", count));
          resource.on.layout(() => test.transition("layout"));
          resource.on.idle(() => test.transition("idle"));
          resource.on.cleanup(() => test.transition("unmounted"));

          return test;
        }, count);

        return {
          value: test,
          dom: react.fragment(
            html.p(test.state),
            html.p("parent:", count),
            react.render(ChildComponent, {
              count: test,
              increment: () => setCount(count + 1),
            })
          ),
        };
      })
      .expectStableValue()
      .expectStable((value) => value)
      .expectHTML(
        ({ state, count, id }) =>
          `<p>${state}</p><p>parent:${count}</p><p>child:${count} id:${String(
            id
          )}</p><label><span>Increment</span><button>++</button></label>`
      );

    function ChildComponent({
      count,
      increment,
    }: {
      count: TestResource;
      increment: () => void;
    }) {
      return react.fragment(
        // verify that the child sees the same TestResource as the parent
        html.p("child:", count.count, " ", "id:", count.id),

        html.label(
          html.span("Increment"),
          html.button({ onClick: () => increment() }, "++")
        )
      );
    }

    const resource = result.value;

    const stableId = mode.match({ strict: () => 3, loose: () => 1 });

    resource.assert(
      mode.match({
        strict: () => "updated",
        loose: () => "idle",
      }),
      0
    );

    result.rerender();
    resource.assert("updated", 0, stableId);

    result.find("button").fire.click();
    resource.assert("updated", 1, stableId);

    result.rerender();
    resource.assert("updated", 1, stableId);

    result.unmount();
    resource.assert("unmounted", 1, stableId);
  }
);

let id = 0;

class TestResource {
  static resetId(): void {
    id = 0;
  }

  static initial(count: number): TestResource {
    return new TestResource("initial", count, ++id);
  }

  #state: string;
  #count: number;
  #id: number;

  private constructor(state: string, count: number, id: number) {
    this.#state = state;
    this.#count = count;
    this.#id = id;
  }

  transition(state: string, count?: number) {
    this.#state = state;

    if (count !== undefined) {
      this.#count = count;
    }
  }

  assert(state: string, count: number, id?: number) {
    entryPoint(() => {
      expect(this.#state).toBe(state);
      expect(this.#count).toBe(count);

      if (id) {
        expect({ id: this.#id }).toMatchObject({ id });
      }
    });
  }

  get state(): string {
    return this.#state;
  }

  get count(): number {
    return this.#count;
  }

  get id(): number | null {
    return this.#id;
  }
}
