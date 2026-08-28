/**
 * Rendering dates for Thai users.
 *
 * The problem this fixes: `toLocaleDateString("th-TH")` selects the **Buddhist**
 * calendar, because that is what the `th-TH` locale specifies. A token expiring
 * in October 2026 therefore printed as "27 ต.ค. 2569" — correct, and read as a
 * typo by everyone who saw it, since every other year this product displays
 * (campaign dates typed by the merchant, the date column of an imported Shopee
 * report, the ISO dates coming back from Meta) is Gregorian.
 *
 * So the calendar is pinned rather than the language: `-u-ca-gregory` keeps Thai
 * month names and Thai ordering, and only changes 2569 back to 2026. Mixing the
 * two eras inside one product is the actual defect — not the Buddhist era, which
 * is perfectly correct on its own.
 *
 * Money lives in `money.ts` for the same reason: one formatter, so the same
 * value cannot render two ways on two screens.
 */

/** Thai language, Gregorian years. Use this anywhere a date is shown to a user. */
export const TH_DATE_LOCALE = "th-TH-u-ca-gregory";

/** "27 ต.ค. 2026" */
export function formatThaiDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(TH_DATE_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "27 ต.ค. 2026 14:05" */
export function formatThaiDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(TH_DATE_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
