import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NoDataState } from "@/pages/Dashboard";

/**
 * The empty state is the only thing a merchant sees when a filter returns
 * nothing, so it is the place a wrong sentence does the most damage — and two
 * of its branches cannot be reached in the seeded workspace, because both
 * sources have data there. Those two are the reason this file exists.
 */
function renderState(props: Partial<Parameters<typeof NoDataState>[0]> = {}) {
  return render(
    <MemoryRouter>
      <NoDataState
        dataRange={null}
        isRangeLoading={false}
        isRangeSelected={false}
        dataSource="all"
        onJumpToData={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

describe("Dashboard empty state, by source filter", () => {
  it("does not offer to connect a platform to someone looking at uploaded files", () => {
    // Connecting a platform would not put a single row into this view.
    renderState({ dataSource: "import" });

    expect(screen.getByText(/ยังไม่มีข้อมูลจากไฟล์ที่อัปโหลด/)).toBeInTheDocument();
    expect(screen.queryByText(/Connect platforms/i)).not.toBeInTheDocument();
  });

  it("sends someone with no uploads to the page that takes uploads", () => {
    renderState({ dataSource: "import" });

    expect(screen.getByRole("link", { name: /Imports/ })).toHaveAttribute("href", "/imports");
  });

  it("does not send someone looking at API data to the imports page", () => {
    // The mirror of the case above: an upload would not fill the API view.
    renderState({ dataSource: "api" });

    expect(screen.getByText(/ยังไม่มีข้อมูลจากการเชื่อม API/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Imports/ })).not.toBeInTheDocument();
  });

  it("keeps the original generic copy when no source filter is applied", () => {
    renderState({ dataSource: "all" });

    expect(screen.getByText(/No data yet/)).toBeInTheDocument();
  });

  it("names the filtered source when the data exists but sits outside the window", () => {
    // "ข้อมูลทั้งหมดครอบคลุม …" would overstate a range measured over one source.
    renderState({
      dataSource: "import",
      dataRange: { start: "2026-06-24", end: "2026-07-23" },
    });

    expect(screen.getByText(/ข้อมูลจากไฟล์ที่อัปโหลดครอบคลุม/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ดูช่วงข้อมูลที่มี/ })).toBeInTheDocument();
  });

  it("says nothing at all while the coverage is still being read", () => {
    // Guessing here is what made /analytics flash "Data Silence Detected" for
    // 1.5s in step 7.5 — the exact false claim this state exists to prevent.
    renderState({ dataSource: "import", isRangeLoading: true });

    expect(screen.queryByText(/ยังไม่มีข้อมูล/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No data yet/)).not.toBeInTheDocument();
  });
});
