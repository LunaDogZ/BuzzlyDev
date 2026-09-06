/**
 * Which advertising platforms Buzzly can actually connect to.
 *
 * The `platforms` table holds five rows, and it always has. That is a catalogue
 * of platforms the product knows about — not a list of things a merchant can
 * connect today. Only Meta has a connector: an OAuth flow, an edge function,
 * and a sync path that returns real rows. The other four have an icon and a
 * name and nothing behind them.
 *
 * The screens used to advertise all five as if they were equal, so a merchant
 * would open a card, type into an API-key box, press Connect, and only then be
 * told the platform is not supported. The refusal was correct and the copy was
 * not, which is the worst way round: the person has already spent the effort by
 * the time the interface admits it cannot help. Data from the other platforms
 * comes in as a downloaded report through `/imports`, and saying so up front
 * costs a sentence.
 *
 * Keep this the single source for the question. `usePlatformConnections` guards
 * the write path with it and the UI decides what to render with it, so the two
 * cannot drift into disagreeing about what is connectable.
 */

/** Platform slugs with a working connector. */
export const CONNECTABLE_PLATFORM_SLUGS = ["facebook"] as const;

export type ConnectablePlatformSlug = (typeof CONNECTABLE_PLATFORM_SLUGS)[number];

/** True when this platform can be connected from inside the product today. */
export function isConnectablePlatform(slug: string | null | undefined): boolean {
  return !!slug && (CONNECTABLE_PLATFORM_SLUGS as readonly string[]).includes(slug);
}

/**
 * How a platform's data reaches Buzzly, said plainly enough to put on a card.
 * Written for a merchant, not a developer — it names the file they already have
 * rather than the integration they do not.
 */
export const IMPORT_ONLY_ROUTE_TH =
  "นำข้อมูลเข้าได้ที่หน้า “นำเข้าข้อมูล” โดยอัปโหลดไฟล์รายงานที่ดาวน์โหลดจากแพลตฟอร์ม";
