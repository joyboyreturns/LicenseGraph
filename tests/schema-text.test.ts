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

  it("gives the assistant canonical tool ids when Studio supplies decorated references", () => {
    const text = describeSchema({
      tables: [{ id: "assets", name: "Assets", reference: "@table[assets]", fields: [{ fieldId: "assets.chosenPrice", name: "Chosen price", reference: "@field[assets.assets.chosenPrice]", dataType: "number", aggregations: ["sum"] }] }],
      relationships: [],
    });
    expect(text).toContain("Table Assets [assets]");
    expect(text).toContain("Chosen price [assets.chosenPrice]");
    expect(text).not.toContain("assets.assets.chosenPrice");
  });

  it("copes with no relationships and no description", () => {
    expect(describeSchema({ tables: [{ name: "T", reference: "t", fields: [] }], relationships: [] })).toBe("Table T [t]");
  });
});
