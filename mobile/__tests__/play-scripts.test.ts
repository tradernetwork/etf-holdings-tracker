// The Play release scripts are plain ESM .mjs; this pins the one pure rule that once blocked an upload.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normFp, sameFp } = require("../scripts/play/fingerprint.cjs");

// What openssl prints for the local keystore, and what EAS returns for the same certificate.
const LOCAL = "83:78:2F:63:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:01:02:03:04:05:06:07:08:09:0A:A3:A9";
const EAS = "83782f63001122334455667788" + "99aabbccddeeff0102030405060708090aa3a9";

describe("EAS keystore fingerprint comparison", () => {
  it("normalises colons, case and whitespace away", () => {
    expect(normFp(LOCAL)).toBe(EAS.toUpperCase());
    expect(normFp(" 83:78:2f ")).toBe("83782F");
    expect(normFp(null)).toBe("");
    expect(normFp(undefined)).toBe("");
  });
  it("matches the same certificate in either format (the genuine-match false negative)", () => {
    expect(EAS.toUpperCase() === LOCAL).toBe(false); // the old comparison
    expect(sameFp(EAS, LOCAL)).toBe(true);
    expect(sameFp(LOCAL, EAS)).toBe(true);
    expect(sameFp(LOCAL, LOCAL.toLowerCase())).toBe(true);
  });
  it("still rejects a different certificate, and never matches empty values", () => {
    expect(sameFp(EAS.replace("a3a9", "a3a8"), LOCAL)).toBe(false);
    expect(sameFp(undefined, LOCAL)).toBe(false);
    expect(sameFp("", "")).toBe(false);
    expect(sameFp(null, undefined)).toBe(false);
  });
});
