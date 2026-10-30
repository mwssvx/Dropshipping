import { describe, expect, it } from "vitest";
import { GRID_PAGE_SIZE, gridPage } from "../src";

describe("showing long product grids a page at a time", () => {
  it("adds 24 products per page and says when there are more", () => {
    expect(GRID_PAGE_SIZE).toBe(24);
    expect(gridPage(30, undefined)).toEqual({ page: 1, shown: 24, total: 30, more: true });
    expect(gridPage(30, "2")).toEqual({ page: 2, shown: 30, total: 30, more: false });
    expect(gridPage(100, "3")).toEqual({ page: 3, shown: 72, total: 100, more: true });
    expect(gridPage(10, undefined)).toEqual({ page: 1, shown: 10, total: 10, more: false });
    expect(gridPage(0, undefined)).toEqual({ page: 1, shown: 0, total: 0, more: false });
  });

  it("clamps pages that don't exist", () => {
    expect(gridPage(30, "99")).toMatchObject({ page: 2, shown: 30 });
    expect(gridPage(30, "0")).toMatchObject({ page: 1, shown: 24 });
    expect(gridPage(30, "-3")).toMatchObject({ page: 1 });
    expect(gridPage(30, "two")).toMatchObject({ page: 1 });
    expect(gridPage(30, "1.9")).toMatchObject({ page: 1 });
  });
});
