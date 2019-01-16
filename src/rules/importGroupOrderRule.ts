/**
 * Copyright (c) 2019-present, ProductBoard, Inc.
 * All rights reserved.
 */

import * as Lint from "tslint";
import * as ts from "typescript";

const ERROR = {
  LINE_ABOVE: "Insert line above",
  REMOVE_EXTRA_LINE_ABOVE: n => `Remove ${n} extra line above`,
  UNEXPECTED_SEPARATOR: n =>
    `Unexpected group separator, remove ${n} extra line above`,
  ABSOLUTE_FIRST: "Absolute path should come first",
  WRONG_ORDER: "Wrong order of the group",
  ABZ: "Incorect alphabetal order, replace the order with the next line",
  FATAL: "Import convention has been violated",
  TOGETHER: "All imports has to be defined together"
};

const UNDEFINED_KEYWORD = "undefined"; // undefined type in convention array

function isAbsolute(text) {
  return text[0] === ".";
}

function countGroupingSeparator(text) {
  return text.split(/\n/).filter(a => !a).length;
}

function isThereGroupingSeparator(text) {
  return countGroupingSeparator(text) === 2;
}

function doesItFollowConvention(
  { currentImport, previousImport },
  configuration
): [boolean, string?] {
  const { convention } = configuration;

  const currentTypeIndex = convention.findIndex(
    type => type === currentImport.i.type
  );
  if (!previousImport.i) {
    return [true];
  }

  if (currentImport.i.type === previousImport.i.type) {
    if (countGroupingSeparator(currentImport.i.text) > 1) {
      const extra = countGroupingSeparator(currentImport.i.text) - 1;

      return [false, ERROR.UNEXPECTED_SEPARATOR(extra)];
    }

    const currentModuleText = currentImport.i.moduleSpecifier;
    const previousModuleText = previousImport.i.moduleSpecifier;

    const currentIsAbsolute = isAbsolute(currentModuleText);
    const previousIsAbsolute = isAbsolute(previousModuleText);

    if (previousIsAbsolute === currentIsAbsolute) {
      if (currentModuleText < previousModuleText) {
        return [false, ERROR.ABZ];
      }

      return [true];
    }

    if (currentIsAbsolute && !previousIsAbsolute) {
      return [true];
    }

    return [false, ERROR.ABSOLUTE_FIRST];
  }

  for (let i = currentTypeIndex; i >= 0; i--) {
    if (convention[i] === previousImport.i.type) {
      if (
        currentTypeIndex - i === 1 &&
        isThereGroupingSeparator(currentImport.i.text)
      ) {
        const extra = countGroupingSeparator(currentImport.i.text) - 1;

        return [false, ERROR.UNEXPECTED_SEPARATOR(extra)];
      }

      return [true];
    }

    if (
      convention[i] === null &&
      !isThereGroupingSeparator(currentImport.i.text)
    ) {
      const lines = countGroupingSeparator(currentImport.i.text);
      if (lines > 2) {
        const extra = lines - 2;

        return [false, ERROR.REMOVE_EXTRA_LINE_ABOVE(extra)];
      }

      return [false, ERROR.LINE_ABOVE];
    }
  }

  return [false, ERROR.WRONG_ORDER];
}

export class Rule extends Lint.Rules.AbstractRule {
  public apply(sourceFile: ts.SourceFile): Array<Lint.RuleFailure> {
    return this.applyWithWalker(
      new ImportGroupOrder(sourceFile, this.getOptions())
    );
  }
}

// The walker takes care of all the work.
class ImportGroupOrder extends Lint.RuleWalker {
  private imports;
  private configuration;
  private importDefinitionFinished = false;
  private hasCriticalError = false;

  constructor(sourceFile, options) {
    super(sourceFile, options);

    const configuration = { ...options.ruleArguments[0] } as {
      convention: Array<string | null>;
      recognizer: {
        [key: string]:
          | RegExp
          | Array<RegExp>
          | { regex: string; flags: string }
          | Array<{ regex: string; flags: string }>;
      };
    };

    if (!configuration) throw new Error("Config has not been found!");

    if (!Array.isArray(configuration.convention)) {
      throw new Error("'convention' has to be an array!");
    }

    try {
      configuration.recognizer = Object.entries(configuration.recognizer)
        .map(([k, r]) => {
          if (k === UNDEFINED_KEYWORD) {
            throw new Error("'undefined' type can't have recognizer!");
          }

          const makeRegExp = exp => {
            const flags = exp.flags || "";
            const regex = exp.regex || exp;

            return new RegExp(regex, flags);
          };

          const strategy = Array.isArray(r) ? r : [r];

          return [k, strategy.map(makeRegExp)];
        })
        .reduce((acc, [k, r]) => {
          acc[k as string] = r;

          return acc;
        }, {});
    } catch (e) {
      throw new Error("Wrong recognizer format!");
    }

    this.imports = new ImportsContainer(sourceFile.text, configuration);
    this.configuration = configuration;
  }

  public visitSourceFile(node: ts.SourceFile) {
    ts.forEachChild(node, n => {
      if (n.kind === ts.SyntaxKind.ImportDeclaration) {
        if (this.importDefinitionFinished) {
          this.addFailure(
            this.createFailure(n.getStart(), n.getWidth(), ERROR.TOGETHER)
          );
        }

        const currentImport = this.imports.add(n);
        const previousImport = this.imports.previous(currentImport);

        const [status, error] = doesItFollowConvention(
          { currentImport, previousImport },
          this.configuration
        );

        if (!status) {
          this.hasCriticalError = true;

          this.addFailure(
            this.createFailure(
              currentImport.i.node.getStart(),
              currentImport.i.node.getWidth(),
              error as string
            )
          );
        }
      } else {
        if (!this.importDefinitionFinished) {
          this.importDefinitionFinished = true;

          if (this.hasCriticalError) {
            this.addFailure(
              this.createFailure(
                this.imports.getLast().i.node.getStart(),
                this.imports.getLast().i.node.getWidth(),
                ERROR.FATAL,
                this.imports.getGeneralImportFix()
              )
            );
          }
        }
      }
    });

    super.visitSourceFile(node);
  }
}

class ImportsContainer {
  private imports: Array<{
    node: ts.Node;
    start: number;
    end: number;
    text: string;
    moduleSpecifier: string;
    type: string;
  }> = [];
  private banner = 0;
  private sourceFile = "";
  private configuration;

  constructor(sourceFile, configuration) {
    this.sourceFile = sourceFile;
    this.configuration = configuration;
  }

  private getType(module: string) {
    const recognizer = this.configuration.convention
      .filter(a => a && a !== UNDEFINED_KEYWORD)
      .map(r => [r, this.configuration.recognizer[r]]) as Array<
      [string, Array<RegExp>]
    >;

    // tslint:disable-next-line
    for (let i = 0; i < recognizer.length; i++) {
      // tslint:disable-next-line
      for (let ii = 0; ii < recognizer[i][1].length; ii++) {
        if (recognizer[i][1][ii].test(module)) {
          return recognizer[i][0];
        }
      }
    }

    return UNDEFINED_KEYWORD;
  }

  public previous({ id }) {
    return { i: this.imports[id - 1], id: id - 1 };
  }

  public getLast() {
    return {
      i: this.imports[this.imports.length - 1],
      id: this.imports.length - 1
    };
  }

  public add(node) {
    const start = node.pos;
    const end = node.end;
    const moduleSpecifier = node.moduleSpecifier.text;

    const newLength = this.imports.push({
      node,
      start,
      end,
      text: this.sourceFile.substring(start, end),
      moduleSpecifier,
      type: this.getType(moduleSpecifier)
    });

    const lastIndex = newLength - 1;

    return {
      i: this.imports[lastIndex],
      id: lastIndex
    };
  }

  public getGeneralImportFix(): Lint.Replacement {
    const imports = [...this.imports];

    // let's handle banner properly
    if ((imports[0].node as any).jsDoc && (imports[0].node as any).jsDoc[0]) {
      this.banner = (imports[0].node as any).jsDoc[0].end; // where banner ends
      imports[0].text = imports[0].text.slice(this.banner);
    }

    /**
     * Sort imports, absolute first, then by ABZ of module path
     * Need to be in sync with doesItFollowConvention implementation
     * @param prev
     * @param next
     */
    const sortImports = (prev, next) => {
      const prevModuleText = prev.moduleSpecifier;
      const nextModuleText = next.moduleSpecifier;

      const prevIsAbsolute = isAbsolute(prevModuleText);
      const nextIsAbsolute = isAbsolute(nextModuleText);

      if (nextIsAbsolute && !prevIsAbsolute) {
        return -1;
      } else if (!nextIsAbsolute && prevIsAbsolute) {
        return 1;
      }

      if (prevModuleText < nextModuleText) {
        return -1;
      } else if (prevModuleText > nextModuleText) {
        return 1;
      }

      return 0;
    };

    const groupsOfImports = imports.reduce((acc, v) => {
      if (!acc[v.type]) {
        acc[v.type] = [v];
      } else {
        acc[v.type].push(v);
      }

      return acc;
    }, {});

    const { convention } = this.configuration;

    const rewrittenImports = convention
      .reduce(
        (acc: { text: string; blank: boolean }, v: any) => {
          if (v === null && !acc.blank) {
            acc.text += "\n";
            acc.blank = true;

            return acc;
          }

          if (!groupsOfImports[v]) return acc;

          acc.text +=
            groupsOfImports[v]
              .sort(sortImports)
              .map(({ text }) => text.trim())
              .join("\n") + "\n";

          acc.blank = false;

          return acc;
        },
        { text: "", blank: false }
      )
      .text.trim();

    return Lint.Replacement.replaceFromTo(
      this.imports[0].start + this.banner,
      this.imports[this.imports.length - 1].end,
      `${this.banner ? "\n\n" : ""}${rewrittenImports}`
    );
  }
}
