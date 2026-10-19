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

describe("permission-sync", () => {
  it("clears a stale blocked flag when the OS says granted", () => {
    const blocked = reduceOptIn(initialOptIn, { type: "enable-result", permission: "denied" });
    const s = reduceOptIn(blocked, { type: "permission-sync", granted: true });
    expect(s.denied).toBe(false);
    expect(optInStatus(s)).not.toMatch(/blocked/);
  });
  it("is a no-op when nothing changed", () => {
    expect(reduceOptIn(initialOptIn, { type: "permission-sync", granted: false })).toBe(initialOptIn);
    const on = reduceOptIn(initialOptIn, { type: "enable-result", permission: "granted", token: "t" });
    expect(reduceOptIn(on, { type: "permission-sync", granted: true })).toBe(on);
  });
  it("turns digests off and flags blocked if permission was revoked outside the app", () => {
    const on = reduceOptIn(initialOptIn, { type: "enable-result", permission: "granted", token: "t" });
    expect(reduceOptIn(on, { type: "permission-sync", granted: false })).toMatchObject({ enabled: false, denied: true });
  });
});

describe("optInStatus with zero follows", () => {
  const on = reduceOptIn(initialOptIn, { type: "enable-result", permission: "granted", token: "t" });
  it("allows the digest but says to follow something first", () => {
    expect(optInStatus(on, 0)).toBe("Follow a stock or fund to get your first digest.");
  });
  it("keeps the normal line once something is followed", () => {
    expect(optInStatus(on, 2)).toMatch(/daily digest/);
    expect(optInStatus(on)).toMatch(/daily digest/);
  });
});
