/**
 * Copyright (c) 2019-present, ProductBoard, Inc.
 * All rights reserved.
 */

import * as Lint from "tslint";
import * as ts from "typescript";

type Configuration = {
  reference: string;
};

export class Rule extends Lint.Rules.AbstractRule {
  public static FAILURE_STRING =
    "Don't import React with asterisk, use `import React from 'react';`";

  public apply(sourceFile: ts.SourceFile): Array<Lint.RuleFailure> {
    return this.applyWithWalker(
      new CorrectReactImportWalker(sourceFile, this.getOptions())
    );
  }
}

class CorrectReactImportWalker extends Lint.RuleWalker {
  private configuration: Configuration;

  constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
    super(sourceFile, options);

    const configuration = {
      reference: "",
      ...options.ruleArguments[0]
    } as Configuration;

    this.configuration = configuration;
  }

  private getFormattedError(error: string): string {
    return (
      error +
      (this.configuration.reference ? ` ${this.configuration.reference}` : "")
    );
  }

  public visitNamespaceImport(node: ts.NamespaceImport) {
    if (
      ts.isStringLiteral(node.parent.parent.moduleSpecifier) &&
      node.parent.parent.moduleSpecifier.text === "react"
    ) {
      return this.addFailureAtNode(
        node,
        this.getFormattedError(Rule.FAILURE_STRING)
      );
    }
    super.visitNamespaceImport(node);
  }
}
