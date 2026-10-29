interface FieldMeta {
  fieldId?: string;
  name: string;
  reference: string;
  dataType: string;
  aggregations?: readonly string[];
}
interface TableMeta {
  id?: string;
  name: string;
  reference: string;
  description?: string;
  fields: readonly FieldMeta[];
}
export interface SchemaMeta {
  description?: string;
  tables: readonly TableMeta[];
  relationships: readonly { type: string; sourceTableId: string; targetTableId: string }[];
}

/**
 * The data schema as compact text for the assistant's instructions. Giving it the field
 * references up front saves the model a round trip, which matters on a rate-limited free model.
 */
export function describeSchema(schema: SchemaMeta): string {
  const tables = schema.tables.map((t) => {
    const fields = t.fields.map((f) => `  - ${f.name} [${f.fieldId ?? f.reference}] (${f.dataType}${f.aggregations?.length ? `; aggregations: ${f.aggregations.join(", ")}` : ""})`);
    return [`Table ${t.name} [${t.id ?? t.reference}]${t.description ? `: ${t.description}` : ""}`, ...fields].join("\n");
  });
  const links = schema.relationships.map((r) => `${r.sourceTableId} ${r.type} ${r.targetTableId}`);
  return [schema.description ?? "", ...tables, links.length ? `Relationships: ${links.join("; ")}` : ""].filter(Boolean).join("\n\n");
}
