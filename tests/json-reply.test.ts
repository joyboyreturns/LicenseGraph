import { describe, expect, it } from "vitest";
import { jsonObjects, readJsonObject } from "../src/extraction/json-reply";

describe("jsonObjects", () => {
  it("finds each top-level object, nested braces and braces inside strings included", () => {
    expect(jsonObjects('a {"x": {"y": 1}} b {"s": "}{ not a brace"} c')).toEqual(['{"x": {"y": 1}}', '{"s": "}{ not a brace"}']);
  });
  it("handles escaped quotes inside strings", () => {
    expect(jsonObjects('{"s": "say \\"}\\" now"}')).toEqual(['{"s": "say \\"}\\" now"}']);
  });
  it("skips a thinking block, even across lines", () => {
    expect(jsonObjects('<think>\n{"draft": true}\n</think>{"final": true}')).toEqual(['{"final": true}']);
  });
  it("leaves an unfinished object out", () => {
    expect(jsonObjects('{"a": 1} {"b": ')).toEqual(['{"a": 1}']);
  });
});

describe("readJsonObject", () => {
  it("prefers the last object that has an answer key, then the last that parses", () => {
    expect(readJsonObject('{"answer": 1} {"answer": 2} {"other": 3}', ["answer"])).toEqual({ answer: 2 });
    expect(readJsonObject('{"a": 1} {"b": 2}', ["answer"])).toEqual({ b: 2 });
  });
  it("skips an object that is not valid JSON", () => {
    expect(readJsonObject('{bad} {"answer": 1}', ["answer"])).toEqual({ answer: 1 });
  });
  it("says so when there is nothing to read, and passes on the JSON error when nothing parses", () => {
    expect(() => readJsonObject("no braces here", ["a"])).toThrow(/no JSON object/);
    expect(() => readJsonObject("{oops}", ["a"])).toThrow(SyntaxError);
  });
});
