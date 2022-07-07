/**
 * A Resource is a two-level formula:
 *
 * - The first formula is the "resource constructor". It is evaluated to produce
 *   the inner formula, and also has an opportunity to register finalizers and
 *   link children.
 * - The inner formula is a regular formula.
 *
 * Whenever any dependencies of the first formula invalidate, the associated
 * finalizers and children are finalized.
 *
 * The inner formula is stateless. This means it can be freely evaluated without
 * worrying about its lifetime.
 */

import type { Stack } from "@starbeam/debug";
import {
  type Description,
  callerStack,
  descriptionFrom,
} from "@starbeam/debug";
import { UNINITIALIZED } from "@starbeam/peer";
import {
  type CleanupTarget,
  type OnCleanup,
  type ReactiveInternals,
  LIFETIME,
  REACTIVE,
} from "@starbeam/timeline";

import type { Reactive } from "../../reactive.js";
import { CompositeInternals } from "../../storage/composite.js";
import { Marker } from "../marker.js";
import { Formula } from "./formula.js";
import { Linkable } from "./linkable.js";
import { FormulaState } from "./state.js";

export interface ResourceBlueprint<T> {
  (builder: BuildResource): () => T;
}

interface ResourceState<T> {
  readonly creation: FormulaState<() => T>;
  readonly lifetime: object;
  readonly formula: Formula<T>;
}

export class ReactiveResource<T> implements Reactive<T> {
  static create<T>(
    create: ResourceBlueprint<T>,
    description: Description
  ): ReactiveResource<T> {
    return new ReactiveResource(
      create,
      Marker(description),
      UNINITIALIZED,
      description
    );
  }

  #create: ResourceBlueprint<T>;
  /**
   * The marker will bump when the resource is first initialized. This allows consumers of the resource to invalidate without forcing them computing the value of the resource.
   */
  #initialized: Marker;
  #state: ResourceState<T> | UNINITIALIZED;
  #description: Description;

  private constructor(
    create: ResourceBlueprint<T>,
    initialized: Marker,
    state: ResourceState<T> | UNINITIALIZED,
    description: Description
  ) {
    this.#create = create;
    this.#initialized = initialized;
    this.#state = state;
    this.#description = description;
  }

  get [REACTIVE](): ReactiveInternals {
    if (this.#state === UNINITIALIZED) {
      return this.#initialized[REACTIVE];
    } else {
      return CompositeInternals(
        [this.#initialized, this.#state.creation, this.#state.formula],
        this.#description
      );
    }
  }

  get current() {
    return this.read(callerStack());
  }

  read(caller: Stack): T {
    if (this.#state === UNINITIALIZED) {
      this.#initialized.update();
      const formula = this.#initialize({ caller });
      return formula.read(caller);
    } else {
      const { creation, formula, lifetime } = this.#state;

      const result = creation.validate(caller);

      if (result.state === "valid") {
        return formula.read(caller);
      } else {
        const formula = this.#initialize({ last: lifetime, caller });
        return formula.read(caller);
      }
    }
  }

  #initialize(options: { last?: object; caller: Stack }) {
    if (options?.last) {
      LIFETIME.finalize(options.last);
    }

    const build = BuildResource.create();

    const { state, value: definition } = FormulaState.evaluate(
      () => this.#create(build),
      this.#description,
      options.caller
    );

    const formula = Formula(
      definition,
      this.#description.implementation({ reason: "constructor formula" })
    );

    const lifetime = BuildResource.lifetime(build);

    LIFETIME.link(this, lifetime);

    this.#state = {
      creation: state,
      lifetime,
      formula,
    };

    return formula;
  }
}

class BuildResource implements CleanupTarget {
  static create() {
    return new BuildResource({});
  }

  static lifetime(build: BuildResource): object {
    return build.#object;
  }

  /**
   * This object represents the instance of the resource being constructed.
   * Finalizers and linked children will be associated with this object, and
   * when the resource is finalized, this object will be finalized;
   */
  #object: object;

  constructor(object: object) {
    this.#object = object;
  }

  readonly on: OnCleanup = {
    cleanup: (handler: () => void) =>
      LIFETIME.on.cleanup(this.#object, handler),
  };

  link(child: object): () => void {
    return LIFETIME.link(this.#object, child);
  }
}

export function Resource<T>(
  create: ResourceBlueprint<T>,
  description?: string | Description
): ResourceConstructor<T> {
  return Linkable.create((owner) => {
    const resource = ReactiveResource.create(
      create,
      descriptionFrom({
        type: "resource",
        api: {
          package: "@starbeam/core",
          name: "Resource",
        },
        fromUser: description,
      })
    );

    LIFETIME.link(owner, resource);
    resource.current;
    return resource;
  });
}

export type Resource<T> = ReactiveResource<T>;
export type ResourceConstructor<T> = Linkable<Resource<T>>;
