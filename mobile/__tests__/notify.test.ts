import { initialOptIn, optInStatus, parseOptIn, reduceOptIn, shouldPrompt } from "../lib/notify";

describe("shouldPrompt", () => {
  const base = { justAdded: true, followCount: 1, platform: "android" };
  it("prompts once, right after the first follow", () => {
    expect(shouldPrompt(initialOptIn, base)).toBe(true);
  });
  it("never prompts on launch (no follow was just added)", () => {
    expect(shouldPrompt(initialOptIn, { ...base, justAdded: false })).toBe(false);
    expect(shouldPrompt(initialOptIn, { ...base, justAdded: false, followCount: 5 })).toBe(false);
  });
  it("never prompts again once answered, or on web", () => {
    expect(shouldPrompt(reduceOptIn(initialOptIn, { type: "not-now" }), base)).toBe(false);
    expect(shouldPrompt(initialOptIn, { ...base, platform: "web" })).toBe(false);
  });
});

describe("reduceOptIn", () => {
  it("not now marks the prompt answered without enabling", () => {
    expect(reduceOptIn(initialOptIn, { type: "not-now" })).toMatchObject({ asked: true, enabled: false });
  });
  it("granted with a token enables push", () => {
    const s = reduceOptIn(initialOptIn, { type: "enable-result", permission: "granted", token: "ExponentPushToken[x]" });
    expect(s).toMatchObject({ enabled: true, awaitingBuild: false, token: "ExponentPushToken[x]", denied: false });
  });
  it("granted without a token (no EAS project) saves the preference and waits for the store build", () => {
    const s = reduceOptIn(initialOptIn, { type: "enable-result", permission: "granted", token: null });
    expect(s).toMatchObject({ enabled: true, awaitingBuild: true, token: null });
    expect(optInStatus(s)).toBe("Notifications will turn on in the store build.");
  });
  it("denied leaves it off and remembers the refusal", () => {
    const s = reduceOptIn(initialOptIn, { type: "enable-result", permission: "denied" });
    expect(s).toMatchObject({ enabled: false, denied: true, asked: true });
    expect(optInStatus(s)).toMatch(/blocked/);
  });
  it("disable turns it off but the prompt stays answered", () => {
    const on = reduceOptIn(initialOptIn, { type: "enable-result", permission: "granted", token: "t" });
    expect(reduceOptIn(on, { type: "disable" })).toMatchObject({ enabled: false, asked: true });
  });
});

test("parseOptIn tolerates junk", () => {
  expect(parseOptIn(null)).toEqual(initialOptIn);
  expect(parseOptIn("{bad")).toEqual(initialOptIn);
  expect(parseOptIn('{"asked":true,"enabled":true,"token":5}')).toMatchObject({ asked: true, enabled: true, token: null });
});
