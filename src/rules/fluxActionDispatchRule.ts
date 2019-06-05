/**
 * Copyright (c) 2019-present, ProductBoard, Inc.
 * All rights reserved.
 */

import * as Lint from 'tslint';
import * as ts from 'typescript';

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Array<Lint.RuleFailure> {
        return this.applyWithWalker(
            new FluxActionDispatchRule(sourceFile, this.getOptions()),
        );
    }
}

type Configuration = {
    reference: string;
};

class FluxActionDispatchRule extends Lint.RuleWalker {
    private configuration: Configuration;

    constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
        super(sourceFile, options);

        const configuration = {
            reference: '',
        } as Configuration;

        this.configuration = configuration;
    }

    private getFormattedError(error: string): string {
        return (
            error +
            (this.configuration.reference ? ` ${this.configuration.reference}` : '')
        );
    }

    private static isAppDispatcherHandleViewActionCall(node: ts.CallExpression): boolean {
        return ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === 'handleViewAction'
            && ts.isIdentifier(node.expression.expression)
            && node.expression.expression.text === 'AppDispatcher'
    }

    private static hasTypedAction(node: ts.CallExpression): boolean {
        return Boolean(node.typeArguments && node.typeArguments.length === 1)
    }

    private static isSimpleAction(argument: ts.Expression): boolean {
        return ts.isObjectLiteralExpression(argument) && argument.properties.length === 1
    }

    private static hasSimpleAction(node: ts.CallExpression): boolean {
        return node.arguments.length === 1 && FluxActionDispatchRule.isSimpleAction(node.arguments[0])
    }

    private static breaksRule(node: ts.CallExpression): boolean {
        return !FluxActionDispatchRule.hasTypedAction(node)
            && !FluxActionDispatchRule.hasSimpleAction(node);
    }

    public visitCallExpression(node: ts.CallExpression) {
        if (FluxActionDispatchRule.isAppDispatcherHandleViewActionCall(node)
            && FluxActionDispatchRule.breaksRule(node)) {
            return this.addFailureAtNode(
                node,
                this.getFormattedError('handleViewAction must be typed or called with action object containing "type" property only.'),
            );
        }

        super.visitCallExpression(node);
    }
}
