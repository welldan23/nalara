// Renders validated content blocks (ADR-011) as plain React elements. There is no HTML string
// anywhere on this path: React escapes all text, and links are re-checked to be https before
// they become an href (defence in depth; the API already refuses anything else).
import type { ReactNode } from 'react';

export type Inline =
  | {
      readonly type: 'text';
      readonly text: string;
      readonly bold?: boolean;
      readonly italic?: boolean;
    }
  | { readonly type: 'link'; readonly text: string; readonly href: string };

export type Block =
  | { readonly type: 'paragraph'; readonly content: readonly Inline[] }
  | { readonly type: 'heading'; readonly level: 2 | 3; readonly content: readonly Inline[] }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly type: 'quote'; readonly content: readonly Inline[]; readonly attribution: string }
  | {
      readonly type: 'stat';
      readonly value: string;
      readonly unit: string;
      readonly period: string;
      readonly label: string;
      readonly citationId: string;
    };

function isSafeHref(href: string): boolean {
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

function InlineContent({ content }: { readonly content: readonly Inline[] }): ReactNode {
  return content.map((part, index) => {
    if (part.type === 'link') {
      return isSafeHref(part.href) ? (
        <a key={index} href={part.href} rel="noopener noreferrer nofollow">
          {part.text}
        </a>
      ) : (
        <span key={index}>{part.text}</span>
      );
    }
    let node: ReactNode = part.text;
    if (part.italic === true) node = <em>{node}</em>;
    if (part.bold === true) node = <strong>{node}</strong>;
    return <span key={index}>{node}</span>;
  });
}

function BlockView({ block }: { readonly block: Block }): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <InlineContent content={block.content} />
        </p>
      );
    case 'heading':
      return block.level === 2 ? (
        <h2>
          <InlineContent content={block.content} />
        </h2>
      ) : (
        <h3>
          <InlineContent content={block.content} />
        </h3>
      );
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <InlineContent content={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'quote':
      return (
        <blockquote>
          <p>
            <InlineContent content={block.content} />
          </p>
          <footer>— {block.attribution}</footer>
        </blockquote>
      );
    case 'stat':
      return (
        <figure className="stat">
          <figcaption>{block.label}</figcaption>
          <p className="stat-value">
            {block.value} <span className="stat-unit">{block.unit}</span>
          </p>
          <p className="stat-period">{block.period}</p>
        </figure>
      );
  }
}

export function ArticleBody({ blocks }: { readonly blocks: readonly Block[] }): ReactNode {
  return (
    <div className="article-body">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
