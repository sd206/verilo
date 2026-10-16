/**
 * Generic finite-state-machine helper (R6).
 *
 * Every status column in the system changes only through a `transition` built
 * from a machine definition in this folder. Invalid transitions throw
 * `InvalidTransitionError`; callers never write a status value directly.
 */

export class InvalidTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`${machine}: transition ${from} → ${to} is not allowed`);
    this.name = "InvalidTransitionError";
  }
}

export interface MachineDefinition<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: S;
  /** Allowed target states for each source state. Terminal states map to []. */
  readonly transitions: { readonly [K in S]: readonly S[] };
}

export interface Machine<S extends string> extends MachineDefinition<S> {
  canTransition(from: S, to: S): boolean;
  /** Returns `to` if allowed; throws InvalidTransitionError otherwise. */
  transition(from: S, to: S): S;
  isTerminal(state: S): boolean;
}

export function defineMachine<S extends string>(def: MachineDefinition<S>): Machine<S> {
  for (const s of def.states) {
    if (!(s in def.transitions)) {
      throw new Error(`${def.name}: state ${s} has no transitions entry`);
    }
    for (const t of def.transitions[s]) {
      if (!def.states.includes(t)) {
        throw new Error(`${def.name}: unknown target state ${t} from ${s}`);
      }
    }
  }
  if (!def.states.includes(def.initial)) {
    throw new Error(`${def.name}: unknown initial state ${def.initial}`);
  }

  const canTransition = (from: S, to: S): boolean =>
    def.states.includes(from) && def.transitions[from].includes(to);

  return {
    ...def,
    canTransition,
    transition(from: S, to: S): S {
      if (!canTransition(from, to)) {
        throw new InvalidTransitionError(def.name, from, to);
      }
      return to;
    },
    isTerminal(state: S): boolean {
      return def.transitions[state].length === 0;
    },
  };
}
