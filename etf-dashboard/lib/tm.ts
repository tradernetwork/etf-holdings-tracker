/** One place for the TraderMatrix hand-off URL. The ref code is load-bearing
 *  (funnel-guard): never append UTM params, tradermatrix.pro drops them when
 *  ?ref= is present. */
export const TM_URL = 'https://www.tradermatrix.pro/?ref=MPHINANCE';

// ponytail: all hrefs land on the homepage until TraderMatrix confirms a
// per-ticker URL that keeps ?ref= — swap it here and every chip follows.
export function tmHref(_ticker?: string): string {
    return TM_URL;
}
