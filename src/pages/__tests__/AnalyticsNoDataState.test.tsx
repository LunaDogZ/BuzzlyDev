import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoDataState } from "@/pages/Analytics";

/** Everything the state needs but this file is not testing. */
const inert = {
  dateMode: "30d" as const,
  setDateMode: vi.fn(),
  weekValue: "2026-07-20",
  setWeekValue: vi.fn(),
  monthValue: "2026-08",
  setMonthValue: vi.fn(),
  yearValue: "2026",
  setYearValue: vi.fn(),
};

function renderState(props: Partial<Parameters<typeof NoDataState>[0]> = {}) {
  return render(
    <NoDataState
      dataRange={null}
      isRangeLoading={false}
      dataSource="all"
      setDataSource={vi.fn()}
      {...inert}
      {...props}
    />
  );
}

describe("Analytics empty state, by source filter", () => {
  it("does not blame tracking pixels when the merchant filtered to uploads", () => {
    // "Ensure your tracking pixels and ad accounts are active" is advice about
    // API data. Shown to someone looking at uploaded files it is simply wrong,
    // and the workspace may be full of data they have merely filtered out.
    renderState({ dataSource: "import" });

    expect(screen.queryByText(/Data Silence Detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มีไฟล์ที่อัปโหลดสำเร็จ/)).toBeInTheDocument();
  });

  it("tells them how to get back to everything", () => {
    // Without this the page looks broken rather than filtered.
    renderState({ dataSource: "api" });

    expect(screen.getByText(/All sources/)).toBeInTheDocument();
  });

  it("keeps the original copy when nothing is filtered", () => {
    renderState({ dataSource: "all" });

    expect(screen.getByText(/Data Silence Detected/)).toBeInTheDocument();
  });

  it("names the filtered source when data exists outside the window", () => {
    renderState({
      dataSource: "import",
      dataRange: { start: "2026-06-24", end: "2026-07-23" },
    });

    expect(screen.getByText(/ข้อมูลจากไฟล์ที่อัปโหลดครอบคลุม/)).toBeInTheDocument();
  });

  it("leaves the source picker reachable, since it is often why the page is empty", () => {
    // Its trigger shows the active filter, so finding that label finds the
    // control — the date pickers beside it are also comboboxes.
    //
    // The label is written out rather than read from AD_DATA_SOURCE_OPTIONS:
    // deriving it from the same constant the component renders would make this
    // assert only that the module agrees with itself, and it would keep passing
    // if the picker vanished from the page in some future refactor.
    renderState({ dataSource: "import" });

    const picker = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("ไฟล์ที่อัปโหลด"));
    expect(picker).toBeDefined();
  });
});
