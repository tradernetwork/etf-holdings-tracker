// The auto-release rule: fingerprint unchanged -> OTA; native change or a version with no binary -> build, never an OTA.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decide, pickBaseline, localHash } = require("../scripts/release/decide.cjs");

const HASH_A = "b0d7cadbe85dc539b1dee5213e5613887c70f9a7";
const HASH_B = "1111111111111111111111111111111111111111";
const base = { id: "build-102", status: "FINISHED", appVersion: "1.0.0", hash: HASH_A };

describe("auto-release decision", () => {
  it("publishes an OTA when the native fingerprint and the app version are unchanged", () => {
    const d = decide({ enabled: true, appVersion: "1.0.0", localFingerprint: HASH_A, baseline: base });
    expect(d.action).toBe("ota");
    expect(d.reason).toMatch(/JS-only/);
  });
  it("builds (and publishes NO OTA) when the fingerprint changed at the same version", () => {
    const d = decide({ enabled: true, appVersion: "1.0.0", localFingerprint: HASH_B, baseline: base });
    expect(d.action).toBe("build");
    expect(d.reason).toMatch(/no OTA for this commit/);
    expect(d.reason).toContain("b0d7cadb");
  });
  it("builds when the app version moved, even with an identical fingerprint (nobody is on that runtime)", () => {
    expect(decide({ enabled: true, appVersion: "1.0.1", localFingerprint: HASH_A, baseline: base }).action).toBe("build");
  });
  it("does nothing when the kill switch is off, whatever the data says", () => {
    for (const enabled of ["false", "FALSE", false]) {
      expect(decide({ enabled, appVersion: "1.0.0", localFingerprint: HASH_B, baseline: base }).action).toBe("skip");
    }
    expect(decide({ enabled: "true", appVersion: "1.0.0", localFingerprint: HASH_A, baseline: base }).action).toBe("ota");
    expect(decide({ enabled: undefined, appVersion: "1.0.0", localFingerprint: HASH_A, baseline: base }).action).toBe("ota");
  });
  it("blocks (ships nothing) when it cannot tell", () => {
    expect(decide({ enabled: true, appVersion: "1.0.0", localFingerprint: null, baseline: base }).action).toBe("blocked");
    expect(decide({ enabled: true, appVersion: "1.0.0", localFingerprint: HASH_A, baseline: null }).action).toBe("blocked");
    const noHash = decide({ enabled: true, appVersion: "1.0.0", localFingerprint: HASH_A, baseline: { ...base, hash: null } });
    expect(noHash.action).toBe("blocked");
    expect(noHash.reason).toMatch(/no fingerprint/);
  });
});

describe("baseline build", () => {
  const b = (id: string, status: string, createdAt: string, hash: string | null, appVersion = "1.0.0") => ({ id, status, createdAt, appVersion, fingerprint: hash ? { hash } : null });
  it("is the newest live build; queued builds count so a second push never builds twice", () => {
    const got = pickBaseline([
      b("old", "FINISHED", "2026-10-12T10:00:00Z", HASH_A),
      b("queued", "IN_QUEUE", "2026-10-12T12:00:00Z", HASH_B),
      b("failed", "ERRORED", "2026-10-12T13:00:00Z", "ffff"),
      b("cancelled", "CANCELED", "2026-10-12T14:00:00Z", "eeee"),
    ]);
    expect(got).toMatchObject({ id: "queued", hash: HASH_B, appVersion: "1.0.0" });
  });
  it("is null when there is no live build, and reads a flat fingerprintHash too", () => {
    expect(pickBaseline([])).toBeNull();
    expect(pickBaseline(undefined)).toBeNull();
    expect(pickBaseline([b("x", "ERRORED", "2026-10-12T10:00:00Z", HASH_A)])).toBeNull();
    expect(pickBaseline([{ id: "f", status: "FINISHED", createdAt: "2026-10-12T10:00:00Z", fingerprintHash: HASH_A }])).toMatchObject({ hash: HASH_A });
  });
});

describe("local fingerprint", () => {
  it("reads the hash from eas fingerprint:generate output", () => {
    expect(localHash(JSON.stringify({ hash: HASH_A, sources: [] }))).toBe(HASH_A);
    expect(localHash({ fingerprint: { hash: HASH_B } })).toBe(HASH_B);
    expect(localHash({})).toBeNull();
  });
});
