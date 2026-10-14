import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'

/**
 * Common developer language aliases that @codemirror/language-data doesn't recognize by default.
 */
const ALIAS_MAP: Record<string, string> = {
    py: 'python',
    golang: 'go',
    rs: 'rust',
    md: 'markdown',
    sh: 'shell',
    zsh: 'shell',
    bash: 'shell',
    shell: 'shell',
    yml: 'yaml',
    docker: 'dockerfile',
    rb: 'ruby',
    cs: 'csharp',
    'c++': 'cpp',
    js: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    htm: 'html',
}

/**
 * Custom codeLanguages resolver function for @codemirror/lang-markdown.
 * Resolves both standard language names and common aliases against the 140+ language descriptions.
 */
export function resolveCodeLanguage(info: string): LanguageDescription | null {
    if (!info) return null
    // Strip trailing comments/attributes after whitespace (e.g. "```js {1-3}")
    const match = /^\S+/.exec(info.trim())
    if (!match) return null
    const raw = match[0].toLowerCase()
    const mapped = ALIAS_MAP[raw] ?? raw
    return LanguageDescription.matchLanguageName(languages, mapped, true)
}

/**
 * Comprehensive GitHub Primer-inspired syntax highlight style.
 * Uses semantic CSS classes so themes (Light / Dark) switch instantaneously via CSS
 * without requiring editor state reconstruction.
 */
export const markdownHighlightStyle = HighlightStyle.define([
    // Keywords & Operators
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], class: 'cm-token-keyword' },
    { tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator], class: 'cm-token-operator' },

    // Literals
    { tag: [t.string, t.special(t.string), t.docString, t.character, t.attributeValue], class: 'cm-token-string' },
    { tag: [t.number, t.integer, t.float], class: 'cm-token-number' },
    { tag: [t.bool, t.null, t.atom], class: 'cm-token-atom' },

    // Functions & Definitions
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], class: 'cm-token-function' },
    { tag: [t.definition(t.variableName), t.definition(t.name)], class: 'cm-token-def' },

    // Types & Classes
    { tag: [t.typeName, t.className, t.namespace], class: 'cm-token-type' },

    // Variables & Properties
    { tag: [t.propertyName, t.labelName], class: 'cm-token-property' },
    { tag: [t.variableName, t.name], class: 'cm-token-variable' },

    // Comments
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'cm-token-comment' },

    // HTML / XML / JSX
    { tag: t.tagName, class: 'cm-token-tag' },
    { tag: t.attributeName, class: 'cm-token-attribute' },

    // Regular Expressions, Escapes & Meta
    { tag: [t.regexp, t.escape], class: 'cm-token-regexp' },
    { tag: [t.meta, t.annotation, t.processingInstruction], class: 'cm-token-meta' },

    // Punctuation & Delimiters
    { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket, t.squareBracket, t.paren, t.brace], class: 'cm-token-punctuation' },

    // Markdown Rich Text Tags (for fallback / core elements)
    { tag: t.heading, class: 'cm-token-heading' },
    { tag: t.monospace, class: 'cm-token-monospace' },
    { tag: t.invalid, class: 'cm-token-invalid' },
])

export const syntaxHighlightExtension = syntaxHighlighting(markdownHighlightStyle)
