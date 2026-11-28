import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { arrow } from "./draw.mjs";
import { figures, parseOnly, validateSvg } from "./index.mjs";

const cli = fileURLToPath(new URL("./index.mjs", import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

describe("arrow()", () => {
  it("deduplicates consecutive identical points without producing non-finite coordinates", () => {
    const startDup = arrow({
      points: [
        [312, 119],
        [312, 119],
        [459, 119],
      ],
    });
    assert.doesNotMatch(startDup, /NaN|Infinity/);
    assert.match(startDup, /d="M312 119L451 119"/);

    const midDup = arrow({
      points: [
        [329, 156],
        [461, 156],
        [461, 156],
        [485, 156],
      ],
    });
    assert.doesNotMatch(midDup, /NaN|Infinity/);

    const shortEnd = arrow({
      points: [
        [0, 0],
        [0, 20],
        [8, 20],
      ],
    });
    assert.doesNotMatch(shortEnd, /NaN|Infinity/);
  });

  it("throws when fewer than two distinct points remain", () => {
    assert.throws(
      () =>
        arrow({
          points: [
            [10, 10],
            [10, 10],
          ],
        }),
      /at least two distinct points/,
    );
  });
});

describe("validateSvg()", () => {
  it("accepts finite SVG markup", () => {
    assert.doesNotThrow(() =>
      validateSvg(
        '<svg><path d="M0 0L10 10"/><text>maintenance and finance</text></svg>',
        "operation-states",
        "wide",
      ),
    );
  });

  it("rejects NaN and Infinity with figure and variant names", () => {
    assert.throws(
      () =>
        validateSvg(
          '<svg><path d="M312 119LNaN NaNQ312 119 312 119L451 119"/></svg>',
          "operation-states",
          "wide",
        ),
      /operation-states \(wide\).*NaN/,
    );
    assert.throws(
      () =>
        validateSvg(
          '<svg><path d="M0 0LInfinity 10"/></svg>',
          "five-companies",
          "narrow",
        ),
      /five-companies \(narrow\).*Infinity/,
    );
    assert.throws(
      () =>
        validateSvg(
          '<svg><rect x="-Infinity" y="0" width="10" height="10"/></svg>',
          "three-answers",
          "wide",
        ),
      /three-answers \(wide\).*-Infinity/,
    );
  });
});

describe("--only validation", () => {
  it("parses valid --only arguments and rejects missing or empty values", () => {
    assert.equal(parseOnly(["--check"]), undefined);
    assert.deepEqual(
      parseOnly(["--check", "--only", "operation-states,five-companies"]),
      ["operation-states", "five-companies"],
    );
    assert.deepEqual(parseOnly(["--only=three-answers"]), ["three-answers"]);

    for (const bad of [
      ["--only"],
      ["--check", "--only"],
      ["--only", "--check"],
      ["--only", ""],
      ["--only="],
      ["--only", "operation-states,"],
    ]) {
      assert.throws(() => parseOnly(bad), /--only/);
    }
  });

  it("rejects unknown figure names", async () => {
    await assert.rejects(
      () => figures(["does-not-exist"]),
      /Unknown figure in --only: does-not-exist/,
    );
    await assert.rejects(
      () => figures(["operation-states", "missing-a", "missing-b"]),
      /Unknown figures in --only: missing-a, missing-b/,
    );
  });

  it("fails closed from the CLI on invalid --only usage and passes on valid figures", () => {
    const missingValue = runCli(["--check", "--only"]);
    assert.notEqual(missingValue.status, 0);
    assert.match(missingValue.stderr, /--only requires/);

    const flagAsValue = runCli(["--only", "--check"]);
    assert.notEqual(flagAsValue.status, 0);
    assert.match(flagAsValue.stderr, /--only requires/);

    const unknown = runCli(["--check", "--only", "not-a-figure"]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown figure in --only: not-a-figure/);

    const valid = runCli([
      "--check",
      "--only",
      "operation-states,five-companies,three-answers",
    ]);
    assert.equal(valid.status, 0, valid.stderr);
  });
});
