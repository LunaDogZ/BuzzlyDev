/**
 * The link if it is a path inside this app, otherwise null.
 *
 * Notification links come from the database and go straight into navigate(),
 * so anything that could leave the app is refused: "//host" and "/\host" are
 * read by browsers as another origin (react-router 6 GHSA-wrjc), and tab or
 * newline are stripped by the URL parser, turning "/\t/host" into "//host".
 */
export function inAppPath(link: string | null | undefined): string | null {
  if (!link || link[0] !== "/") return null;
  if (link[1] === "/" || link[1] === "\\") return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(link)) return null;
  return link;
}
