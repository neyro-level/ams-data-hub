import { describe, expect, it } from "vitest";
import { normalizeSnapshotPublicAddress } from "../src/modules/ingestion-core/domain/snapshot-public-address.ts";

describe("snapshot public address boundary", () => {
  it.each([
    ["Синтетический город, ул. Тестовая, д. 9, кв. 42", "Синтетический город, ул. Тестовая, д. 9"],
    ["Synthetic City, Test Street, house 9, apartment #42", "Synthetic City, Test Street, house 9"],
    ["Synthetic City, Test Street, house 9, apt.42-A", "Synthetic City, Test Street, house 9"],
    ["Синтетический город, д. 9, помещение №42", "Синтетический город, д. 9"],
  ])("removes explicit unit from %s", (raw, expected) => {
    expect(normalizeSnapshotPublicAddress(raw, "42")).toBe(expected);
  });
  it("removes the captured unlabelled private component without removing the building", () => {
    expect(normalizeSnapshotPublicAddress("Synthetic City, house 42, 42", "42")).toBe("Synthetic City, house 42");
    expect(normalizeSnapshotPublicAddress("Synthetic City, house 9, 42", "42")).toBe("Synthetic City, house 9");
  });
  it("rejects ambiguous surviving markers rather than publishing the original", () => {
    expect(() => normalizeSnapshotPublicAddress("Synthetic City Test Street 9 42", "42")).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
    expect(() => normalizeSnapshotPublicAddress("Synthetic City, кв. №")).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
    expect(() => normalizeSnapshotPublicAddress("кв. 42", "42")).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
    expect(() => normalizeSnapshotPublicAddress("Synthetic City", "private arbitrary text")).toThrow();
  });
  it("preserves ordinary street names and rejects non-address content and bounds", () => {
    expect(normalizeSnapshotPublicAddress("Synthetic City, Flatiron Street, дом 9")).toBe("Synthetic City, Flatiron Street, дом 9");
    for (const raw of ["<b>City</b>", "City user@example.invalid", "https://example.invalid", "City\nTest", "x".repeat(2001)]) {
      expect(() => normalizeSnapshotPublicAddress(raw)).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
    }
  });
  it("rejects forbidden characters created by Unicode normalization", () => {
    for (const raw of ["City user＠example.invalid", "City ＜script＞", "City ＋７ １２３ ４５６ ７８９０"]) {
      expect(() => normalizeSnapshotPublicAddress(raw)).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
    }
    expect(() => normalizeSnapshotPublicAddress("City, house 9, 4\u200b2", "42")).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
    expect(() => normalizeSnapshotPublicAddress("City, house 9, аptA12", "A12")).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
  });
  it("removes full compound unit components and never leaves a private numeric suffix", () => {
    expect(normalizeSnapshotPublicAddress("City, house 9, apt. 42 / 43", "42/43")).toBe("City, house 9");
    expect(normalizeSnapshotPublicAddress("City, house 9, кв. 42.5")).toBe("City, house 9");
    expect(normalizeSnapshotPublicAddress("City, house 9, apt٤٢")).toBe("City, house 9");
    expect(normalizeSnapshotPublicAddress("City, house 9, 42 / 43", "42 / 43")).toBe("City, house 9");
    expect(() => normalizeSnapshotPublicAddress("City Street 42 / 43", "42/43")).toThrow("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
  });
  it("removes an attached alphabetic unit only when it matches the captured marker", () => {
    expect(normalizeSnapshotPublicAddress("City, house 9, aptA12", "A12")).toBe("City, house 9");
    expect(normalizeSnapshotPublicAddress("Город, дом 9, квА12", "А12")).toBe("Город, дом 9");
    expect(normalizeSnapshotPublicAddress("City, house 9, aptA12 / B13", "A12/B13")).toBe("City, house 9");
    expect(normalizeSnapshotPublicAddress("Город, дом 9, квА12 - Б13", "А12-Б13")).toBe("Город, дом 9");
    expect(normalizeSnapshotPublicAddress("City, Flatiron Street, house 9", "A12")).toBe("City, Flatiron Street, house 9");
  });
  it("keeps composed label, separator and compound-marker variants private", () => {
    for (const label of ["apt", "unit", "кв", "квартира", "помещение"]) {
      for (const marker of ["42", "A12", "А12", "42/43", "A12/B13", "А12-Б13"]) {
        for (const separator of [" ", ".", "#", "", ". # "]) {
          const spaced = marker.replace(/([/-])/gu, " $1 ");
          expect(normalizeSnapshotPublicAddress(`City, house 9, ${label}${separator}${spaced}`, marker)).toBe("City, house 9");
        }
      }
    }
  });
});
