import CodeBlock from '@tiptap/extension-code-block';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { normalizeHrefInput, sanitizeHref } from '@/shared/lib/href';

// Importing HTML must not let another site's presentation metadata enter JSON.
const PaperLink = Link.extend({
  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (element) =>
          sanitizeHref(element.getAttribute('href')) !== null ? null : false,
      },
    ];
  },
  addCommands() {
    const commands = this.parent!();
    return {
      ...commands,
      setLink: (attributes) => (props) =>
        sanitizeHref(attributes.href) !== null &&
        commands.setLink!(attributes)(props),
      toggleLink: (attributes) => (props) =>
        (!attributes?.href || sanitizeHref(attributes.href) !== null) &&
        commands.toggleLink!(attributes)(props),
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      target: { default: '_blank', parseHTML: () => '_blank' },
      rel: {
        default: 'noopener noreferrer',
        parseHTML: () => 'noopener noreferrer',
      },
      class: { default: null, parseHTML: () => null },
      title: { default: null, parseHTML: () => null },
    };
  },
});

// Removing the attribute from the editor schema covers HTML, fenced-code input
// rules, and VS Code's direct node creation while preserving code-block content.
const PaperCodeBlock = CodeBlock.extend({ addAttributes: () => ({}) });

const TextOnlyMarks = Extension.create({
  name: 'textOnlyMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged))
            return;
          const transaction = state.tr;
          state.doc.descendants((node, position) => {
            if (node.type.name === 'hardBreak' && node.marks.length) {
              transaction.setNodeMarkup(position, undefined, node.attrs, []);
            }
          });
          return transaction.docChanged ? transaction : undefined;
        },
      }),
    ];
  },
});

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    codeBlock: false,
    link: false,
    underline: false,
  }),
  PaperCodeBlock,
  PaperLink.configure({
    autolink: true,
    defaultProtocol: 'https',
    openOnClick: false,
    // TipTap validates raw link text before generating its https:/mailto: href.
    // Explicit commands and HTML anchors use the strict checks above instead.
    isAllowedUri: (href) => !!normalizeHrefInput(href),
    // TipTap's selection-paste handler bypasses isAllowedUri.
    shouldAutoLink: (href) => !!normalizeHrefInput(href),
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  }),
  Image.configure({ allowBase64: false }),
  Underline,
  TextOnlyMarks,
];
