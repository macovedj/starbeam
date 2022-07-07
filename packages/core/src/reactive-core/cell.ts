import { isObject } from "@starbeam/core-utils";
import {
  type Description,
  type Stack,
  callerStack,
  descriptionFrom,
  DisplayStruct,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ifDebug,
} from "@starbeam/debug";
import { type ReactiveInternals, INSPECT, REACTIVE } from "@starbeam/timeline";

import type { Reactive } from "../reactive.js";
import { MutableInternalsImpl } from "../storage/mutable.js";

export interface CellPolicy<T, U = T> {
  equals(a: T, b: T): boolean;
  map(value: T): U;
}

export type Equality<T> = (a: T, b: T) => boolean;

export class ReactiveCell<T> implements Reactive<T> {
  static create<T>(
    value: T,
    equals: Equality<T> = Object.is,
    internals: MutableInternalsImpl
  ): ReactiveCell<T> {
    return new ReactiveCell(value, equals, internals);
  }

  #value: T;
  readonly #internals: MutableInternalsImpl;
  readonly #equals: Equality<T>;

  private constructor(
    value: T,
    equals: Equality<T>,
    reactive: MutableInternalsImpl
  ) {
    this.#value = value;
    this.#equals = equals;
    this.#internals = reactive;
  }

  @ifDebug
  [INSPECT]() {
    const { description, debug } = this.#internals;

    return DisplayStruct(`Cell (${description.describe()})`, {
      value: this.#value,
      updated: debug.lastUpdated,
    });
  }

  @ifDebug
  toString() {
    return `Cell (${String(this.#value)})`;
  }

  freeze(): void {
    this.#internals.freeze();
  }

  get current(): T {
    return this.read(callerStack());
  }

  set current(value: T) {
    this.#set(value);
  }

  read(caller: Stack | undefined): T {
    this.#internals.consume(caller);
    return this.#value;
  }

  /**
   * Returns true if the value was updated, and false if the value was already present and equal to
   * the new value.
   */
  set(value: T): boolean {
    return this.#set(value);
  }

  update(updater: (prev: T) => T): boolean {
    return this.#set(updater(this.#value));
  }

  #set(value: T): boolean {
    if (this.#equals(this.#value, value)) {
      return false;
    }

    this.#value = value;
    this.#internals.update();
    return true;
  }

  get [REACTIVE](): ReactiveInternals {
    return this.#internals;
  }
}

/**
 * The `equals` parameter is used to determine whether a new value is equal to
 * the current value. If `equals` returns `true` for a new value, the old value
 * remains in the cell and the cell's timestamp doesn't advance.
 *
 * It defaults to `Object.is` (`===` except that `Object.is(NaN, NaN)` is
 * `true`).
 * */

export function Cell<T>(
  value: T,
  description?:
    | string
    | { description?: string | Description; equals?: Equality<T> }
): Cell<T> {
  let desc: Description;
  let equals: Equality<T>;

  if (typeof description === "string" || description === undefined) {
    desc = normalize(description);
    equals = Object.is;
  } else {
    desc = normalize(description.description);
    equals = description.equals ?? Object.is;
  }

  return ReactiveCell.create(value, equals, MutableInternalsImpl.create(desc));
}

function normalize(description?: string | Description): Description {
  if (typeof description === "string" || description === undefined) {
    return descriptionFrom({
      type: "cell",
      api: {
        package: "@starbeam/core",
        name: "Cell",
      },
      fromUser: description,
    });
  }

  return description;
}

Cell.is = <T>(value: unknown): value is Cell<T> => {
  return isObject(value) && value instanceof ReactiveCell;
};

export type Cell<T = unknown> = ReactiveCell<T>;
