/**
 * Sentences in a licence that the rules engine does not check, found by plain keyword matching. The engine decides
 * only what the project's brief requires; a licence can also say it may be revoked, or that the work may not be used
 * to train AI. These are put in front of the person approving, so "verified" is never read as "nothing else to read".
 */
export type FinePrintTopic = "termination" | "ai" | "resale" | "liability" | "reporting" | "moral";

export interface FinePrintItem {
  topic: FinePrintTopic;
  label: string;
  sentence: string;
}

const TOPICS: { topic: FinePrintTopic; label: string; pattern: RegExp }[] = [
  { topic: "termination", label: "Can be ended early", pattern: /\b(terminat\w*|revok\w*|revocable|rescind\w*|withdraw\w*)\b/i },
  { topic: "ai", label: "AI and data use", pattern: /\b(machine learning|artificial intelligence|\bAI\b|train(ing)? (a |an |any )?(model|data)|dataset|scrap\w+)\b/i },
  { topic: "resale", label: "Resale and sharing", pattern: /\b(resell\w*|resale|redistribut\w*|transfer\w*|assign\w*|stock library|standalone)\b/i },
  { topic: "liability", label: "Liability and claims", pattern: /\b(indemn\w*|warrant\w*|liabilit\w*|damages|disclaim\w*)\b/i },
  { topic: "reporting", label: "Reporting or audit duties", pattern: /\b(audit\w*|report(ing)? (to|the)|royalt\w*|cue sheet|notify|notification)\b/i },
  { topic: "moral", label: "Changes to the work", pattern: /\b(moral rights|modif\w*|alter(?:s|ed|ing|ation|ations)?|derivative|edit(ing)? the (track|image|work|font|clip))\b/i },
];

/** At most `limit` sentences, one per topic first so a long licence cannot crowd out the other kinds of clause. */
export function finePrint(text: string, limit = 4): FinePrintItem[] {
  const sentences = text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const found: FinePrintItem[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const hit = TOPICS.find((t) => t.pattern.test(sentence));
    if (hit && !seen.has(sentence)) {
      seen.add(sentence);
      found.push({ topic: hit.topic, label: hit.label, sentence });
    }
  }
  const firstOfEach = found.filter((f, i) => found.findIndex((g) => g.topic === f.topic) === i);
  return [...firstOfEach, ...found.filter((f) => !firstOfEach.includes(f))].slice(0, limit);
}
