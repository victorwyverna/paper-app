import type { TiptapDocument } from '@paper-app/types';
import { z } from 'zod';
import { publicApiUrl } from '../config/public-api.js';
import { parseCanonicalUploadKey } from '../lib/upload-key.js';

const TIPTAP_MAX_DEPTH = 20;
const TIPTAP_MAX_NODES = 10_000;

const nodeKeys = {
  doc: ['type', 'content'],
  paragraph: ['type', 'content'],
  heading: ['type', 'attrs', 'content'],
  blockquote: ['type', 'content'],
  bulletList: ['type', 'content'],
  orderedList: ['type', 'attrs', 'content'],
  listItem: ['type', 'content'],
  codeBlock: ['type', 'attrs', 'content'],
  horizontalRule: ['type'],
  hardBreak: ['type'],
  image: ['type', 'attrs'],
  text: ['type', 'text', 'marks'],
} as const;

type ParentKind = 'root' | 'block' | 'inline' | 'list' | 'code';
type Frame = { node: unknown; parentKind: ParentKind; depth: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function allowedKeysFor(type: unknown): readonly string[] {
  return typeof type === 'string' && Object.hasOwn(nodeKeys, type)
    ? nodeKeys[type as keyof typeof nodeKeys]
    : [];
}

function isLinkHref(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    /\p{Cc}|\\/u.test(value) ||
    /\s$/.test(value) ||
    !/^(?:https?:\/\/[^/\s?#\\]+|mailto:)/i.test(value)
  )
    return false;
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validMarks(marks: unknown): boolean {
  if (!Array.isArray(marks)) return false;
  const seen = new Set<string>();
  for (const mark of marks) {
    if (!isRecord(mark) || typeof mark.type !== 'string' || seen.has(mark.type))
      return false;
    seen.add(mark.type);
    switch (mark.type) {
      case 'bold':
      case 'italic':
      case 'strike':
      case 'underline':
      case 'code':
        if (!hasOnlyKeys(mark, ['type'])) return false;
        break;
      case 'link': {
        if (!hasOnlyKeys(mark, ['type', 'attrs']) || !isRecord(mark.attrs))
          return false;
        const attrs = mark.attrs;
        if (
          !hasOnlyKeys(attrs, ['href', 'target', 'rel', 'class', 'title']) ||
          !isLinkHref(attrs.href)
        )
          return false;
        if (
          'target' in attrs &&
          attrs.target !== null &&
          attrs.target !== '_blank'
        )
          return false;
        if (
          'rel' in attrs &&
          attrs.rel !== null &&
          attrs.rel !== 'noopener noreferrer'
        )
          return false;
        if ('class' in attrs && attrs.class !== null) return false;
        if ('title' in attrs && attrs.title !== null) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

export function createTiptapDocumentSchema({
  uploadOrigin,
}: {
  uploadOrigin: string;
}): z.ZodType<TiptapDocument> {
  return z.custom<TiptapDocument>((document) => {
    const stack: Frame[] = [{ node: document, parentKind: 'root', depth: 1 }];
    let nodeCount = 0;

    while (stack.length > 0) {
      const { node, parentKind, depth } = stack.pop()!;
      nodeCount += 1;
      if (nodeCount > TIPTAP_MAX_NODES || depth > TIPTAP_MAX_DEPTH)
        return false;
      if (!isRecord(node) || !hasOnlyKeys(node, allowedKeysFor(node.type)))
        return false;

      const children = (
        kind: ParentKind,
        optional = false,
        nonempty = false
      ): boolean => {
        if (!('content' in node)) return optional;
        if (
          !Array.isArray(node.content) ||
          (nonempty && node.content.length === 0)
        )
          return false;
        for (const child of node.content)
          stack.push({ node: child, parentKind: kind, depth: depth + 1 });
        return true;
      };

      switch (node.type) {
        case 'doc':
          if (parentKind !== 'root' || !children('block')) return false;
          break;
        case 'paragraph':
          if (parentKind !== 'block' || !children('inline', true)) return false;
          break;
        case 'heading':
          if (
            parentKind !== 'block' ||
            !isRecord(node.attrs) ||
            !hasOnlyKeys(node.attrs, ['level']) ||
            (node.attrs.level !== 2 && node.attrs.level !== 3) ||
            !children('inline', true)
          )
            return false;
          break;
        case 'blockquote':
          if (parentKind !== 'block' || !children('block', false, true))
            return false;
          break;
        case 'bulletList':
          if (parentKind !== 'block' || !children('list', false, true))
            return false;
          break;
        case 'orderedList':
          if (parentKind !== 'block') return false;
          if ('attrs' in node) {
            if (
              !isRecord(node.attrs) ||
              !hasOnlyKeys(node.attrs, ['start', 'type'])
            )
              return false;
            const attrs = node.attrs;
            if (
              'start' in attrs &&
              (typeof attrs.start !== 'number' ||
                !Number.isInteger(attrs.start) ||
                attrs.start < 1)
            )
              return false;
            if (
              'type' in attrs &&
              attrs.type !== null &&
              (typeof attrs.type !== 'string' ||
                !['1', 'a', 'A', 'i', 'I'].includes(attrs.type))
            )
              return false;
          }
          if (!children('list', false, true)) return false;
          break;
        case 'listItem':
          if (parentKind !== 'list' || !children('block', false, true))
            return false;
          break;
        case 'codeBlock':
          if (parentKind !== 'block') return false;
          if (
            'attrs' in node &&
            (!isRecord(node.attrs) ||
              !hasOnlyKeys(node.attrs, ['language']) ||
              ('language' in node.attrs && node.attrs.language !== null))
          )
            return false;
          if (!children('code', true)) return false;
          break;
        case 'horizontalRule':
          if (parentKind !== 'block') return false;
          break;
        case 'hardBreak':
          if (parentKind !== 'inline') return false;
          break;
        case 'image': {
          if (parentKind !== 'block' || !isRecord(node.attrs)) return false;
          const attrs = node.attrs;
          if (
            !hasOnlyKeys(attrs, ['src', 'alt', 'title', 'width', 'height']) ||
            !parseCanonicalUploadKey(attrs.src, uploadOrigin)
          )
            return false;
          for (const key of ['alt', 'title']) {
            if (
              key in attrs &&
              attrs[key] !== null &&
              typeof attrs[key] !== 'string'
            )
              return false;
          }
          for (const key of ['width', 'height']) {
            if (key in attrs && attrs[key] !== null) return false;
          }
          break;
        }
        case 'text':
          if (
            (parentKind !== 'inline' && parentKind !== 'code') ||
            typeof node.text !== 'string'
          )
            return false;
          if (
            'marks' in node &&
            (parentKind === 'code' || !validMarks(node.marks))
          )
            return false;
          break;
        default:
          return false;
      }
    }
    return true;
  });
}

export const tiptapDocumentSchema = createTiptapDocumentSchema({
  uploadOrigin: publicApiUrl.origin,
});
