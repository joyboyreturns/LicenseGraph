import { describe, expect, it } from "vitest";
import { describeSchema } from "../src/dashboard/schema-text";

describe("describeSchema", () => {
  it("lists tables, field references, aggregations and relationships", () => {
    const text = describeSchema({
      description: "One licensing run.",
      tables: [{ name: "Offers", reference: "offers", description: "Licence offers", fields: [{ name: "Price", reference: "offers.price", dataType: "number", aggregations: ["sum", "avg"] }, { name: "Asset", reference: "offers.asset", dataType: "string" }] }],
      relationships: [{ type: "one-to-many", sourceTableId: "assets", targetTableId: "offers" }],
    });
    expect(text).toContain("One licensing run.");
    expect(text).toContain("Table Offers [offers]: Licence offers");
    expect(text).toContain("- Price [offers.price] (number; aggregations: sum, avg)");
    expect(text).toContain("- Asset [offers.asset] (string)");
    expect(text).toContain("Relationships: assets one-to-many offers");
  });

  it("copes with no relationships and no description", () => {
    expect(describeSchema({ tables: [{ name: "T", reference: "t", fields: [] }], relationships: [] })).toBe("Table T [t]");
  });
});
