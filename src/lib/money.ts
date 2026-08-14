/**
 * Rendering Thai baht.
 *
 * One function, because there were two and they disagreed. The dashboard used
 * `value.toLocaleString()` and the reports page used
 * `value.toLocaleString("th-TH", { minimumFractionDigits: 2 })`, so the same
 * amount could print differently on two screens of the same app — and neither
 * capped the fraction digits, which is the defect that made this worth fixing:
 * `Number.prototype.toLocaleString` defaults to **up to three**, so a derived
 * figure such as spend ÷ conversions rendered as `฿46.554`.
 *
 * Baht has two decimal places. A third is a precision no Thai amount has, on
 * a product whose entire claim is that its money reconciles exactly.
 */

/** Fixed locale, so a total cannot render differently for two people looking
 *  at the same workspace. `th-TH` groups in thousands the same way `en-US`
 *  does, and it is the audience's own locale. */
const THB_FORMAT = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  // Both bounds. `minimum` alone still admits a third digit — that was the
  // bug on the reports page, which set only the minimum and looked fixed.
  maximumFractionDigits: 2,
});

/**
 * A baht amount, always to satang.
 *
 * Both bounds are pinned rather than just the ceiling: a whole number must not
 * print as `฿1,350` next to a `฿1,350.08` that came from the same column, or
 * the two read as different quantities.
 *
 * Non-finite input renders as an em dash. NaN reaching a money cell means an
 * upstream division produced nothing, and `฿NaN` is worse than an admission
 * that there is no figure.
 */
export function formatTHB(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `฿${THB_FORMAT.format(value)}`;
}
