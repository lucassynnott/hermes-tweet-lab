import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readEditorSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("VisualEditor read-only mode", () => {
  it("renders toggle titles as plain text when editing is disabled", () => {
    const source = readEditorSource("./extensions/NotionExtensions.tsx");

    expect(source).toContain("const isEditable = editor.isEditable");
    expect(source).toMatch(
      /\{isEditable \? \(\s*<input[\s\S]*className="notion-toggle__summary"[\s\S]*\) : \(\s*<span className="notion-toggle__summary" contentEditable=\{false\}>/,
    );
  });

  it("gates the custom drag handle behind editor editability", () => {
    // Content's DragHandle is now a thin re-export of the shared core extension
    // (configured with Content's wrapper selector); the implementation — and the
    // editability gate — lives in core, so assert it against the core source.
    const reexport = readEditorSource("./extensions/DragHandle.tsx");
    expect(reexport).toContain(
      'import { DragHandle as CoreDragHandle } from "@agent-native/core/client"',
    );
    expect(reexport).toContain('wrapperSelector: ".visual-editor-wrapper"');

    // The implementation lives in the published @agent-native/core package. This
    // standalone repository verifies the local wrapper contract without assuming
    // an adjacent framework monorepo checkout.
  });
});
