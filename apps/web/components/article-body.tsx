// Renders validated content blocks (ADR-011) as plain React elements. There is no HTML string
// anywhere on this path: React escapes all text, and links are re-checked to be https before
// they become an href (defence in depth; the API already refuses anything else).
import type { ReactNode } from 'react';
import { ChartFigure } from './chart';
import type { ChartBlock, ChartRender } from './chart';

export type { ChartRender } from './chart';

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
    }
  | { readonly type: 'image'; readonly mediaId: string }
  | ChartBlock;

/** What the body needs to draw one library image (P1-09). */
export interface MediaRender {
  readonly altText: string;
  readonly caption: string | null;
  readonly attribution: string | null;
  readonly width: number;
  readonly height: number;
  readonly aiGenerated: boolean;
}

interface ImageOptions {
  readonly media: Readonly<Record<string, MediaRender>>;
  /** Charted dataset versions by `dataset@version` (P4-03). */
  readonly charts: Readonly<Record<string, ChartRender>>;
  /** URL of an image's bytes: the public route for readers, the founder route for previews. */
  readonly imageSrc: (mediaId: string) => string;
  /** Previews say so when an image is missing; readers just do not see it. */
  readonly preview: boolean;
}

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

export interface CitationView {
  readonly id: string;
  readonly url: string;
  readonly publisher: string;
  readonly title: string;
  readonly accessedAt: string;
  readonly primary: boolean;
}

function ImageView({
  mediaId,
  images,
}: {
  readonly mediaId: string;
  readonly images: ImageOptions;
}): ReactNode {
  const asset = images.media[mediaId];
  if (asset === undefined) {
    return images.preview ? (
      <p className="image-missing">Gambar tidak ada di pustaka media, atau belum berlisensi.</p>
    ) : null;
  }
  const hasCaption = asset.caption !== null || asset.attribution !== null || asset.aiGenerated;
  return (
    <figure className="article-image">
      {/* Bytes come stripped and size-checked from the API; next/image would need sharp (ADR-001). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images.imageSrc(mediaId)}
        alt={asset.altText}
        width={asset.width}
        height={asset.height}
        loading="lazy"
        decoding="async"
      />
      {hasCaption && (
        <figcaption>
          {asset.caption !== null && <span>{asset.caption} </span>}
          {asset.attribution !== null && <span className="credit">{asset.attribution}</span>}
          {asset.aiGenerated && <span className="badge">Ilustrasi AI</span>}
        </figcaption>
      )}
    </figure>
  );
}

function BlockView({
  block,
  index,
  citations,
  images,
}: {
  readonly block: Block;
  readonly index: number;
  readonly citations: readonly CitationView[];
  readonly images: ImageOptions;
}): ReactNode {
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
          <StatSource citationId={block.citationId} citations={citations} />
        </figure>
      );
    case 'image':
      return <ImageView mediaId={block.mediaId} images={images} />;
    case 'chart':
      return (
        <ChartFigure
          block={block}
          chart={images.charts[`${block.dataset}@${String(block.version)}`]}
          id={`grafik-${String(index + 1)}`}
          preview={images.preview}
        />
      );
  }
}

function StatSource({
  citationId,
  citations,
}: {
  readonly citationId: string;
  readonly citations: readonly CitationView[];
}): ReactNode {
  const index = citations.findIndex((citation) => citation.id === citationId);
  const citation = citations[index];
  if (citation === undefined) return <p className="stat-source">Sumber tidak ditemukan</p>;
  return (
    <p className="stat-source">
      Sumber: <a href={`#sumber-${String(index + 1)}`}>[{index + 1}]</a> {citation.publisher}
    </p>
  );
}

export const publicImageSrc = (mediaId: string) =>
  `/api/v1/public/media/${encodeURIComponent(mediaId)}`;
export const previewImageSrc = (mediaId: string) =>
  `/api/v1/os/media/${encodeURIComponent(mediaId)}/file`;

export function ArticleBody({
  blocks,
  citations = [],
  media = {},
  charts = {},
  imageSrc = publicImageSrc,
  preview = false,
}: {
  readonly blocks: readonly Block[];
  readonly citations?: readonly CitationView[];
  readonly media?: Readonly<Record<string, MediaRender>>;
  readonly charts?: Readonly<Record<string, ChartRender>>;
  readonly imageSrc?: (mediaId: string) => string;
  readonly preview?: boolean;
}): ReactNode {
  const images: ImageOptions = { media, charts, imageSrc, preview };
  return (
    <div className="article-body">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} index={index} citations={citations} images={images} />
      ))}
    </div>
  );
}

const accessFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' });

/** Numbered source list; ids `sumber-N` are the anchors that number blocks link to. */
export function CitationList({
  citations,
  intro,
}: {
  readonly citations: readonly CitationView[];
  /** One sentence under the heading, on the public article. */
  readonly intro?: string;
}): ReactNode {
  if (citations.length === 0) return null;
  return (
    <section className="citations" aria-labelledby="sumber-judul">
      <h2 id="sumber-judul">Barang bukti</h2>
      {intro !== undefined && <p className="citations-intro">{intro}</p>}
      <ol className="cite-list">
        {citations.map((citation, index) => (
          <li key={citation.id} id={`sumber-${String(index + 1)}`}>
            <p className="cite-tag" aria-hidden="true">
              Bukti {index + 1}
            </p>
            <p className="cite-publisher">
              {citation.publisher}
              {citation.primary && <span className="badge">Sumber primer</span>}
            </p>
            <p className="cite-title">
              {isSafeHref(citation.url) ? (
                <a href={citation.url} rel="noopener noreferrer nofollow">
                  {citation.title === '' ? citation.url : citation.title}
                </a>
              ) : (
                <span>{citation.title}</span>
              )}
            </p>
            <p className="cite-meta">
              Diakses {accessFormat.format(new Date(`${citation.accessedAt}T00:00:00Z`))}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
