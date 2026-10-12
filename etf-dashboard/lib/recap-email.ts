/**
 * recap-email.ts — Weekly "Smart money recap" email template helper.
 *
 * Produces inline-styled 600px HTML + plain-text, matching the "Weekly recap email"
 * design in TT Channels.dc.html.  Pure data-in / strings-out — no network calls,
 * no side-effects.  Wire it up to your mailer of choice.
 *
 * The TraderMatrix CTA always carries ?ref=MPHINANCE (load-bearing referral code —
 * never swap for UTM params; tradermatrix.pro drops them when ?ref= is present).
 */

export const TM_REF_URL = 'https://www.tradermatrix.pro/?ref=MPHINANCE';

// ─── Input shape ──────────────────────────────────────────────────────────────

export interface RecapRow {
    /** Ticker symbol, e.g. "NVDA" */
    ticker: string;
    /** Company / fund name */
    name: string;
    /** Short signal descriptor, e.g. "9 funds · 3 families" */
    detail: string;
    /** Formatted delta string, e.g. "+0.62% wk" */
    delta: string;
    /** true = green (buying), false = red (selling) */
    up: boolean;
}

export interface NewLayeringEntry {
    ticker: string;
    families: number;
    days: number;
}

export interface RecapEmailInput {
    /** Week label shown above the headline, e.g. "WEEK OF OCT 6 – 10" */
    weekLabel: string;
    /** Bold headline sentence */
    headline: string;
    /** Top movers table rows (up to ~5 rows looks best) */
    rows: RecapRow[];
    /** New Layering Radar entries for the footer paragraph */
    newLayering: NewLayeringEntry[];
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface RecapEmailOutput {
    subject: string;
    html: string;
    text: string;
}

// ─── Colour constants (inline-styled — no external CSS) ───────────────────────

const C = {
    canvas: '#0a0f1e',
    surface: '#111827',
    rule: '#1f2937',
    white: '#ffffff',
    subtext: '#94a3b8',
    equity: '#00d4ff',
    buy: '#00ff88',
    sell: '#ff4444',
    tmGold: '#e0b03a',
    tmGoldBright: '#f2c95c',
    tmSteel: '#c8d8ec',
    meta: '#475569',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderRow(r: RecapRow): string {
    const deltaColor = r.up ? C.buy : C.sell;
    return `
      <tr>
        <td style="padding:10px 12px;background:${C.surface};border:1px solid ${C.rule};border-radius:8px;font-size:14px;color:${C.subtext}">
          <b style="font-family:monospace;color:${C.equity}">${esc(r.ticker)}</b>&nbsp;${esc(r.name)}
          <span style="font-size:12px;color:${C.meta}">&nbsp;·&nbsp;${esc(r.detail)}</span>
        </td>
        <td style="padding:10px 12px;background:${C.surface};border:1px solid ${C.rule};border-radius:8px;font-family:monospace;color:${deltaColor};font-size:14px;text-align:right;white-space:nowrap">
          ${esc(r.delta)}
        </td>
      </tr>
      <tr><td colspan="2" style="height:6px"></td></tr>`;
}

function layeringHtmlPara(entries: NewLayeringEntry[]): string {
    if (!entries.length) return '';
    const names = entries.map(
        (e) => `<b style="color:${C.white}">${esc(e.ticker)}</b> (${e.families} families in ${e.days} days)`,
    );
    const body = `New on the Layering Radar: ${names.join(' and ')}.
      <a href="https://tickertrace.pro/layering" style="color:${C.equity}">Open the radar →</a>`;
    return `<p style="margin:0;font-size:14px;color:${C.subtext};line-height:1.6">${body}</p>`;
}

function layeringPlainText(entries: NewLayeringEntry[]): string {
    if (!entries.length) return '';
    const names = entries.map(
        (e) => `${e.ticker} (${e.families} families in ${e.days} days)`,
    );
    return `New on the Layering Radar: ${names.join(' and ')}. https://tickertrace.pro/layering`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function renderRecapEmail(input: RecapEmailInput): RecapEmailOutput {
    const { weekLabel, headline, rows, newLayering } = input;

    const subject = `TickerTrace weekly: ${headline}`;

    const tmBoxHeading = 'Did the options tape agree?';
    const tmBoxBody =
        "Check whether this week's ETF buys also drew unusual call flow on the options tape. TraderMatrix has the strikes, the sizes, and TraderLady's read on each.";

    const rowsHtml = rows.map(renderRow).join('');
    const layeringSection = layeringHtmlPara(newLayering);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9;padding:24px 16px">
    <tr><td align="center">

      <!-- Outer card — 600px wide, dark canvas -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="600"
             style="max-width:600px;width:100%;background:${C.canvas};border:1px solid ${C.rule};border-radius:8px;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">

        <!-- TickerTrace + TraderMatrix header -->
        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid ${C.rule}">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:12px;vertical-align:middle">
                  <img src="https://tickertrace.pro/brand/tm-mark.png" alt="" width="36" height="36"
                       style="display:block;width:36px;height:36px;object-fit:contain">
                </td>
                <td style="vertical-align:middle">
                  <div style="font-size:17px;line-height:1;letter-spacing:.14em;color:${C.tmSteel}">
                    <span style="font-weight:300">TICKER</span><span style="font-weight:800">TRACE</span>
                  </div>
                  <div style="font-size:9px;font-weight:600;letter-spacing:.22em;color:${C.tmGold};margin-top:4px;text-transform:uppercase">
                    A TRADERMATRIX PRODUCT
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Main body -->
        <tr>
          <td style="padding:28px 32px">

            <!-- Week label + headline -->
            <p style="margin:0 0 6px;font-size:12px;font-family:monospace;color:${C.meta};text-transform:uppercase;letter-spacing:.05em">
              ${esc(weekLabel)}
            </p>
            <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;font-weight:900;color:${C.white}">
              ${esc(headline)}
            </h1>

            <!-- Movers table -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${rowsHtml}
            </table>

            <!-- TraderMatrix gold CTA box -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                   style="margin-top:20px;border:1px solid rgba(224,176,58,.35);border-radius:10px;background:rgba(224,176,58,.06)">
              <tr>
                <td style="padding:16px">
                  <p style="margin:0 0 6px;font-size:15px;font-weight:800;color:${C.tmGoldBright}">
                    ${esc(tmBoxHeading)}
                  </p>
                  <p style="margin:0 0 12px;font-size:14px;color:#cbd5e1;line-height:1.5">
                    ${esc(tmBoxBody)}
                  </p>
                  <a href="${TM_REF_URL}"
                     data-placement="email_weekly"
                     style="display:inline-block;padding:12px 20px;border-radius:10px;background:${C.tmGold};color:${C.canvas};font-weight:800;font-size:14px;text-decoration:none">
                    See this week's flow &#x2192;
                  </a>
                </td>
              </tr>
            </table>

            ${layeringSection ? `\n            <!-- Layering paragraph -->\n            <div style="margin-top:20px">${layeringSection}</div>` : ''}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid ${C.rule};font-size:11px;color:${C.meta};line-height:1.6">
            You're getting this because you subscribed on tickertrace.pro
            &nbsp;&#x00B7;&nbsp;
            <a href="https://tickertrace.pro/unsubscribe" style="color:${C.meta}">Unsubscribe</a>
            &nbsp;&#x00B7;&nbsp;
            TraderMatrix links are referral links.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // ─── Plain text ───────────────────────────────────────────────────────────

    const rowsText = rows
        .map((r) => `  ${r.ticker.padEnd(6)} ${r.delta.padStart(12)}  ${r.name} · ${r.detail}`)
        .join('\n');

    const layeringLine = layeringPlainText(newLayering);

    const text = [
        'TICKERTRACE WEEKLY — A TRADERMATRIX PRODUCT',
        weekLabel,
        '',
        headline,
        '',
        rowsText,
        '',
        '---',
        tmBoxHeading,
        '',
        tmBoxBody,
        '',
        `See this week's flow -> ${TM_REF_URL}`,
        '',
        ...(layeringLine ? ['---', layeringLine, ''] : []),
        '---',
        "You're getting this because you subscribed on tickertrace.pro",
        'Unsubscribe: https://tickertrace.pro/unsubscribe',
        'TraderMatrix links are referral links.',
    ].join('\n');

    return { subject, html, text };
}
