import { describe, expect, it } from "vitest";

import {
  LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  LifecycleTransitionError,
  isValidLifecycleTransition,
  lifecycleStateSchema,
  lifecycleTransitionSchema,
  transitionLifecycleState,
} from "../src/index.js";

const invalidLifecycleValues: readonly unknown[] = [
  undefined,
  null,
  "draft",
  "",
  "AUTHORIZED ",
  0,
  1.5,
  false,
  {},
  [],
];

describe("lifecycle transition properties", () => {
  it("publishes every state and transition list as immutable table data", () => {
    expect(Object.isFrozen(LIFECYCLE_STATES)).toBe(true);
    expect(Object.isFrozen(LIFECYCLE_TRANSITIONS)).toBe(true);

    for (const state of LIFECYCLE_STATES) {
      expect(Object.hasOwn(LIFECYCLE_TRANSITIONS, state)).toBe(true);
      expect(Object.isFrozen(LIFECYCLE_TRANSITIONS[state])).toBe(true);
    }
  });

  it("rejects every canonical state pair absent from the explicit table", () => {
    for (const from of LIFECYCLE_STATES) {
      for (const to of LIFECYCLE_STATES) {
        const allowed = LIFECYCLE_TRANSITIONS[from].includes(to);

        expect(isValidLifecycleTransition(from, to)).toBe(allowed);
        expect(lifecycleTransitionSchema.safeParse({ from, to }).success).toBe(
          allowed,
        );

        if (allowed) {
          expect(transitionLifecycleState(from, to)).toBe(to);
        } else {
          expect(() => transitionLifecycleState(from, to)).toThrow(
            LifecycleTransitionError,
          );
        }
      }
    }
  });

  it("fails closed for every malformed state input", () => {
    for (const invalid of invalidLifecycleValues) {
      expect(lifecycleStateSchema.safeParse(invalid).success).toBe(false);

      for (const state of LIFECYCLE_STATES) {
        expect(isValidLifecycleTransition(invalid, state)).toBe(false);
        expect(isValidLifecycleTransition(state, invalid)).toBe(false);
        expect(() => transitionLifecycleState(invalid, state)).toThrow(
          TypeError,
        );
        expect(() => transitionLifecycleState(state, invalid)).toThrow(
          TypeError,
        );
        expect(
          lifecycleTransitionSchema.safeParse({ from: invalid, to: state })
            .success,
        ).toBe(false);
        expect(
          lifecycleTransitionSchema.safeParse({ from: state, to: invalid })
            .success,
        ).toBe(false);
      }
    }
  });

  it("keeps terminal and exceptional recovery edges explicit", () => {
    const expectedEdges = {
      RECONCILED: [],
      DENIED: [],
      EXPIRED: [],
      SIMULATION_FAILED: [],
      REVOKED: [],
      BROADCAST_FAILED: ["DISPUTED"],
      DISPUTED: ["RECONCILED"],
      REVALIDATION_REQUIRED: ["VALIDATED", "EXPIRED", "DENIED", "REVOKED"],
    } as const;

    for (const [state, edges] of Object.entries(expectedEdges)) {
      expect(
        LIFECYCLE_TRANSITIONS[state as keyof typeof expectedEdges],
      ).toEqual(edges);
    }
  });
});
