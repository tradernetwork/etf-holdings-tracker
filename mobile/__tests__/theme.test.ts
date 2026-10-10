import { DEFAULT_THEME_PREFERENCE, parseThemePreference, resolveTheme } from "../lib/theme";

describe("default and migration", () => {
  it("a new install (nothing stored) defaults to Auto", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("auto");
    expect(parseThemePreference(null)).toBe("auto");
    expect(parseThemePreference(undefined)).toBe("auto");
    expect(parseThemePreference("")).toBe("auto");
  });
  it("migrates the legacy stored values as EXPLICIT choices", () => {
    expect(parseThemePreference("terminal")).toBe("terminal");
    expect(parseThemePreference("paper")).toBe("paper");
  });
  it("keeps a stored Auto, and treats junk as Auto", () => {
    expect(parseThemePreference("auto")).toBe("auto");
    expect(parseThemePreference("sepia")).toBe("auto");
    expect(parseThemePreference("{}")).toBe("auto");
  });
});

describe("resolveTheme", () => {
  it("Auto follows the phone both ways", () => {
    expect(resolveTheme("auto", "dark")).toBe("terminal");
    expect(resolveTheme("auto", "light")).toBe("paper");
  });
  it("Auto updates when the phone switches (same preference, new scheme)", () => {
    expect(resolveTheme("auto", "light")).toBe("paper");
    expect(resolveTheme("auto", "dark")).toBe("terminal");
  });
  it("Auto with an unknown scheme falls back to the dark look", () => {
    expect(resolveTheme("auto", null)).toBe("terminal");
    expect(resolveTheme("auto", undefined)).toBe("terminal");
  });
  it("an explicit choice ignores the phone", () => {
    for (const scheme of ["dark", "light", null] as const) {
      expect(resolveTheme("terminal", scheme)).toBe("terminal");
      expect(resolveTheme("paper", scheme)).toBe("paper");
    }
  });
});
