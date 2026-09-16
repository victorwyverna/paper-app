import { Fragment, type ReactNode } from 'react';

import type {
  TiptapDocument,
  TiptapMark,
  TiptapNode,
} from '@/entities/article';

import styles from './article-view-page.module.css';

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function withMark(content: ReactNode, mark: TiptapMark): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{content}</strong>;
    case 'italic':
      return <em>{content}</em>;
    case 'strike':
      return <s>{content}</s>;
    case 'underline':
      return <u>{content}</u>;
    case 'code':
      return <code>{content}</code>;
    case 'link': {
      const href = safeUrl(mark.attrs?.href);

      if (!href) {
        return content;
      }

      const opensNewTab = mark.attrs?.target === '_blank';

      return (
        <a
          href={href}
          rel={opensNewTab ? 'noreferrer noopener' : undefined}
          target={opensNewTab ? '_blank' : undefined}
        >
          {content}
        </a>
      );
    }
    default:
      return content;
  }
}

function renderChildren(node: TiptapNode): ReactNode {
  return node.content?.map((child, index) => renderNode(child, index));
}

function renderNode(node: TiptapNode, key: number): ReactNode {
  if (node.type === 'text') {
    return (
      <Fragment key={key}>
        {(node.marks ?? []).reduce<ReactNode>(
          (content, mark) => withMark(content, mark),
          node.text ?? ''
        )}
      </Fragment>
    );
  }

  const children = renderChildren(node);

  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading': {
      const level = Number(node.attrs?.level);

      if (level === 3) return <h3 key={key}>{children}</h3>;
      if (level === 4) return <h4 key={key}>{children}</h4>;
      if (level === 5) return <h5 key={key}>{children}</h5>;
      if (level === 6) return <h6 key={key}>{children}</h6>;

      return <h2 key={key}>{children}</h2>;
    }
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList':
      return <ol key={key}>{children}</ol>;
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case 'hardBreak':
      return <br key={key} />;
    case 'horizontalRule':
      return <hr key={key} />;
    case 'image': {
      const src = safeUrl(node.attrs?.src);

      return src ? (
        <figure key={key}>
          <img
            alt={typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''}
            src={src}
          />
          {typeof node.attrs?.title === 'string' && node.attrs.title ? (
            <figcaption>{node.attrs.title}</figcaption>
          ) : null}
        </figure>
      ) : null;
    }
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

export function ArticleContent({ document }: { document: TiptapDocument }) {
  return (
    <div className={styles.content}>
      {document.content.map((node, index) => renderNode(node, index))}
    </div>
  );
}
