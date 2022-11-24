import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';
import { createRule, getNodeName, isFunction, parseJestFnCall } from './utils';

const findCallbackArg = (
  node: TSESTree.CallExpression,
  isJestEach: boolean,
  context: TSESLint.RuleContext<string, unknown[]>,
): TSESTree.CallExpression['arguments'][0] | null => {
  if (isJestEach) {
    return node.arguments[1];
  }

  const jestFnCall = parseJestFnCall(node, context);

  if (jestFnCall?.type === 'hook' && node.arguments.length >= 1) {
    return node.arguments[0];
  }

  if (jestFnCall?.type === 'test' && node.arguments.length >= 2) {
    return node.arguments[1];
  }

  return null;
};

export default createRule({
  name: __filename,
  meta: {
    docs: {
      category: 'Best Practices',
      description: 'Disallow using a callback in asynchronous tests and hooks',
      recommended: 'error',
    },
    messages: {
      noDoneCallback:
        'Return a Promise instead of relying on callback parameter',
      suggestWrappingInPromise: 'Wrap in `new Promise({{ callback }} => ...`',
      useAwaitInsteadOfCallback:
        'Use await instead of callback in async functions',
    },
    schema: [],
    type: 'suggestion',
    hasSuggestions: true,
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        // done is the second argument for it.each, not the first
        const isJestEach = getNodeName(node.callee)?.endsWith('.each') ?? false;

        if (
          isJestEach &&
          node.callee.type !== AST_NODE_TYPES.TaggedTemplateExpression
        ) {
          // isJestEach but not a TaggedTemplateExpression, so this must be
          // the `jest.each([])()` syntax which this rule doesn't support due
          // to its complexity (see jest-community/eslint-plugin-jest#710)
          return;
        }

        const callback = findCallbackArg(node, isJestEach, context);
        const callbackArgIndex = Number(isJestEach);

        if (
          !callback ||
          !isFunction(callback) ||
          callback.params.length !== 1 + callbackArgIndex
        ) {
          return;
        }

        const argument = callback.params[callbackArgIndex];

        if (argument.type !== AST_NODE_TYPES.Identifier) {
          context.report({
            node: argument,
            messageId: 'noDoneCallback',
          });

          return;
        }

        if (callback.async) {
          context.report({
            node: argument,
            messageId: 'useAwaitInsteadOfCallback',
          });

          return;
        }

        context.report({
          node: argument,
          messageId: 'noDoneCallback',
          suggest: [
            {
              messageId: 'suggestWrappingInPromise',
              data: { callback: argument.name },
              fix(fixer) {
                const { body, params } = callback;

                const sourceCode = context.getSourceCode();
                const firstBodyToken = sourceCode.getFirstToken(body);
                const lastBodyToken = sourceCode.getLastToken(body);

                const [firstParam] = params;
                const lastParam = params[params.length - 1];

                const tokenBeforeFirstParam =
                  sourceCode.getTokenBefore(firstParam);
                let tokenAfterLastParam = sourceCode.getTokenAfter(lastParam);

                if (tokenAfterLastParam?.value === ',') {
                  tokenAfterLastParam =
                    sourceCode.getTokenAfter(tokenAfterLastParam);
                }

                /* istanbul ignore if */
                if (
                  !firstBodyToken ||
                  !lastBodyToken ||
                  !tokenBeforeFirstParam ||
                  !tokenAfterLastParam
                ) {
                  throw new Error(
                    `Unexpected null when attempting to fix ${context.getFilename()} - please file a github issue at https://github.com/jest-community/eslint-plugin-jest`,
                  );
                }

                let argumentFix = fixer.replaceText(firstParam, '()');

                if (
                  tokenBeforeFirstParam.value === '(' &&
                  tokenAfterLastParam.value === ')'
                ) {
                  argumentFix = fixer.removeRange([
                    tokenBeforeFirstParam.range[1],
                    tokenAfterLastParam.range[0],
                  ]);
                }

                const newCallback = argument.name;

                let beforeReplacement = `new Promise(${newCallback} => `;
                let afterReplacement = ')';
                let replaceBefore = true;

                if (body.type === AST_NODE_TYPES.BlockStatement) {
                  const keyword = 'return';

                  beforeReplacement = `${keyword} ${beforeReplacement}{`;
                  afterReplacement += '}';
                  replaceBefore = false;
                }

                return [
                  argumentFix,
                  replaceBefore
                    ? fixer.insertTextBefore(firstBodyToken, beforeReplacement)
                    : fixer.insertTextAfter(firstBodyToken, beforeReplacement),
                  fixer.insertTextAfter(lastBodyToken, afterReplacement),
                ];
              },
            },
          ],
        });
      },
    };
  },
});
