import { describe, expect, it } from "vitest";

import {
  ENFORCEMENT_GRADES,
  enforcementGradeSchema,
  meetsMinimumEnforcementGrade,
} from "../src/enforcement-grade.js";

describe("enforcementGradeSchema", () => {
  it("accepts only the five canonical uppercase grades", () => {
    expect(ENFORCEMENT_GRADES).toEqual([
      "ONCHAIN",
      "SIGNER",
      "CONTROL_PLANE",
      "ADVISORY",
      "UNSUPPORTED",
    ]);

    for (const grade of ENFORCEMENT_GRADES) {
      expect(enforcementGradeSchema.parse(grade)).toBe(grade);
    }
  });

  it.each([
    "onchain",
    "Control_Plane",
    "control-plane",
    "UNKNOWN",
    "",
    1,
    null,
    undefined,
  ])("rejects noncanonical value %j", (candidate) => {
    expect(enforcementGradeSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("meetsMinimumEnforcementGrade", () => {
  it("implements the complete strongest-to-weakest ordering", () => {
    for (const [actualIndex, actual] of ENFORCEMENT_GRADES.entries()) {
      for (const [requiredIndex, required] of ENFORCEMENT_GRADES.entries()) {
        expect(
          meetsMinimumEnforcementGrade(actual, required),
          `${actual} against ${required}`,
        ).toBe(actualIndex <= requiredIndex);
      }
    }
  });
});
