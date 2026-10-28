import type { ProjectChange } from "@/src/core/whatif";
import { mediaIn, months, placesIn, withoutNegatedExclusivity } from "./brief";

/** What a sentence asked to change, and the same thing in words for the person to check. */
export interface ReadChange {
  change: ProjectChange;
  described: string[];
}

/** The rest of a sentence a negation covers: "no", "don't need", "without" and the few words after it. */
const NOT = String.raw`(?:no|not|without|never|don'?t|do not|doesn'?t|does not|needn'?t|need not|no need(?: to| for)?|can'?t|cannot|unable to)`;
const negated = (text: string, word: string) => new RegExp(String.raw`\b${NOT}\s+(?:\w+\s+){0,3}?${word}`, "i").test(text);

const ADDS = /\b(also|as well|in addition|additionally|add|adding|plus|too)\b/i;

/**
 * Read a plain-English change ("only Canada for 6 months, no exclusivity") into the parts of a brief it
 * states. Only what the text says is returned, so everything it leaves out stays as it is. Instant and
 * offline; it never guesses a default, because a wrong guess here would show a wrong price.
 * `current` lets "also in Canada" add to the places or media already chosen instead of replacing them.
 */
export function readChange(text: string, current: { territories: string[]; mediums: string[] } = { territories: [], mediums: [] }): ReadChange {
  const change: ProjectChange = {};
  const described: string[] = [];
  const adds = ADDS.test(text);

  const places = placesIn(text);
  if (places.length) {
    const merged = adds && !places.includes("WORLD") ? [...new Set([...current.territories.filter((t) => t !== "WORLD"), ...places])] : places;
    change.territories = merged;
    described.push(merged.includes("WORLD") ? "Worldwide" : merged.length > 6 ? "European Union" : merged.join(", "));
  }

  const term = months(text);
  if (term !== undefined) {
    change.termMonths = term;
    described.push(term >= 1200 ? "Perpetual term" : `${term} ${term === 1 ? "month" : "months"}`);
  }

  const mediums = mediaIn(text);
  if (/\b(any|all) (?:media|medium|channels?)\b/i.test(text)) {
    change.mediums = [];
    described.push("Any media");
  } else if (mediums.length) {
    change.mediums = adds ? [...new Set([...current.mediums, ...mediums])] : mediums;
    described.push(change.mediums.join(", "));
  }

  if (/\bnon[- ]?commercial\b|\bnot (?:for )?commercial\b|\bpersonal use\b|\bnot for profit\b|\bnot[- ]for[- ]profit\b/i.test(text)) {
    change.commercial = false;
    described.push("Non-commercial");
  } else if (/\bcommercial\b|\badvert\w*|\bcampaign\b/i.test(text)) {
    change.commercial = true;
    described.push("Commercial");
  }

  if (negated(text, "(?:credit|credits|attribution)") && !/\b(?:no|without) (?:problem|issue)s? (?:to |with )?credit/i.test(text)) {
    change.canCredit = false;
    described.push("Cannot credit creators");
  } else if (/\b(?:can|could|will|able to|happy to|willing to)\s+(?:\w+\s+)?(?:credit|attribute)\b|\bwith (?:credit|attribution)\b|\bgive (?:them )?credit\b/i.test(text)) {
    change.canCredit = true;
    described.push("Can credit creators");
  }

  if (negated(text, "(?:sublicens\\w*|resell\\w*|redistribut\\w*)")) {
    change.needsSublicensing = false;
    described.push("No sublicensing");
  } else if (/\b(?:sublicens\w*|resell\w*|white[- ]?label|redistribut\w*)\b/i.test(text)) {
    change.needsSublicensing = true;
    described.push("Needs sublicensing");
  }

  if (withoutNegatedExclusivity(text) !== text && !/\b(?:exclusive|exclusivity|no one else|nobody else)\b/i.test(withoutNegatedExclusivity(text))) {
    change.requiresExclusive = false;
    described.push("No exclusivity");
  } else if (/\b(?:exclusive|exclusivity|no one else|nobody else)\b/i.test(withoutNegatedExclusivity(text))) {
    change.requiresExclusive = true;
    described.push("Needs exclusivity");
  }

  return { change, described };
}
