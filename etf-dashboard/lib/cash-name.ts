/**
 * Cash / T-bill detection by name, mirroring api/data.py `is_cash_name`, `is_cash_placeholder` and `_is_company_name`
 * (and the mobile app's `isCashName`). Pure, with no app imports, so node:test can load it directly.
 *
 * The word CASH must be a whole token: CASHBUILD, EUROCASH, METCASH and FirstCash are stocks. A company or share-class name
 * (COMMON STOCK, ORD, ADR, ETF, INC, CORP, LTD, PLC, HOLDINGS, GROUP, CO, SA, NV, AG ...) is never cash or a T-bill.
 */
const STOCK_NAME_RE = /COMMON STOCK|\bORD\b|\bADR\b|\bETF\b/i;
const COMPANY_NAME_RE = /\b(COMMON STOCK|INC|CORP|CORPORATION|LTD|PLC|HOLDINGS|BANCORP|FINANCIAL|ADR|CO|COMPANY|GROUP|SA|NV|AG)\b/i;
const CASH_WORD_RE = /\bCASH\b/i;
const TREASURY_BILL_RE = /\bTREASURY BILL\b/i;

export const isCompanyName = (name: string): boolean => STOCK_NAME_RE.test(name) || COMPANY_NAME_RE.test(name);

/** "CASH", "CASH & OTHER", "CASH EQUIVALENT", "USD CASH" ... but never a company that merely contains the letters. */
export const isCashName = (name: string): boolean => !isCompanyName(name) && CASH_WORD_RE.test(name);

/** A literal CASH / USD / MARGIN ticker is a cash line only when the NAME is not a company: Pathward Financial trades as CASH. */
export const isCashPlaceholder = (ticker: string, name: string): boolean =>
  ['CASH', 'USD', 'MARGIN'].includes(ticker.trim().toUpperCase()) && !COMPANY_NAME_RE.test(name);

/** Rows the website's /holdings leaves out: blank/OTHER/TBILL tickers, cash placeholders, cash and T-bill names. */
export function isExcludedHolding(ticker: unknown, name: unknown): boolean {
  const t = String(ticker ?? '').trim().toUpperCase();
  const n = String(name ?? '');
  if (t === '' || t === 'OTHER' || t === 'TBILL') return true;
  if (isCashPlaceholder(t, n)) return true;
  return isCashName(n) || (!isCompanyName(n) && TREASURY_BILL_RE.test(n));
}
