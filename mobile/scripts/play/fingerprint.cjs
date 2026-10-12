// Pure fingerprint helpers, CommonJS so the .mjs scripts (via default import) and Jest can share them.

/** Hex digits only, upper-case: EAS returns lower-case hex WITHOUT colons, openssl prints upper-case WITH colons. */
const normFp = (x) => String(x == null ? '' : x).toUpperCase().replace(/[^0-9A-F]/g, '');

/** Same certificate fingerprint whatever the formatting. Empty/missing never matches. */
const sameFp = (a, b) => normFp(a) !== '' && normFp(a) === normFp(b);

module.exports = { normFp, sameFp };
