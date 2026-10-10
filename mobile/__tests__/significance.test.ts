import { isSignificant, significanceThreshold } from "../lib/significance";

test("thresholds mirror api/data.py", () => {
  expect(significanceThreshold("AVUV")).toBe(0.01);
  expect(significanceThreshold("ARKK")).toBe(0.02);
});
test("boundary values count as significant", () => {
  expect(isSignificant("ARKK", 0.02)).toBe(true);
  expect(isSignificant("ARKK", -0.019)).toBe(false);
  expect(isSignificant("AVUS", -0.0104)).toBe(true);
});
