// Draws one card (1080×1350) as PNG: satori lays the slide out as SVG (text becomes paths, so
// no font is needed afterwards) and resvg rasterises it. Everything runs in-process: no browser,
// no network, and only the self-hosted OFL fonts below.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { CARD_HEIGHT, CARD_WIDTH } from './deck.ts';
import type { CardContext, Slide } from './deck.ts';

/** "Berkas perkara" with Rana: the same sepia palette as the site (lib/tokens.ts in the web app). */
const C = {
  paper: '#E7E0D9',
  ink: '#241E19',
  muted: '#54493F',
  manila: '#D9C7A0',
  manilaInk: '#241E19',
  stamp: '#7E2B1F',
  accent: '#7E2B1F',
  gold: '#B08D52',
  rule: '#CBBFB2',
  sheet: '#F4EFE9',
} as const;

const require = createRequire(import.meta.url);

interface FontSpec {
  readonly name: string;
  readonly file: string;
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
}

const FONT_FILES: readonly FontSpec[] = [
  {
    name: 'Caslon',
    file: '@fontsource/libre-caslon-display/files/libre-caslon-display-latin-400-normal.woff',
    weight: 400,
    style: 'normal',
  },
  {
    name: 'CaslonText',
    file: '@fontsource/libre-caslon-text/files/libre-caslon-text-latin-700-normal.woff',
    weight: 700,
    style: 'normal',
  },
  {
    name: 'Literata',
    file: '@fontsource/literata/files/literata-latin-400-normal.woff',
    weight: 400,
    style: 'normal',
  },
  {
    name: 'Literata',
    file: '@fontsource/literata/files/literata-latin-700-normal.woff',
    weight: 700,
    style: 'normal',
  },
  {
    name: 'Literata',
    file: '@fontsource/literata/files/literata-latin-400-italic.woff',
    weight: 400,
    style: 'italic',
  },
  {
    name: 'Courier',
    file: '@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff',
    weight: 400,
    style: 'normal',
  },
  {
    name: 'Courier',
    file: '@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff',
    weight: 700,
    style: 'normal',
  },
];

const RANA = new URL('../../../assets/maskot/menjelaskan.png', import.meta.url);
let ranaPromise: Promise<string> | null = null;
/** Rana explaining, as a data URI (founder's mascot art, see docs/brand). */
function rana(): Promise<string> {
  ranaPromise ??= readFile(RANA).then((data) => `data:image/png;base64,${data.toString('base64')}`);
  return ranaPromise;
}

type SatoriFont = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' | 'italic' };
let fontsPromise: Promise<SatoriFont[]> | null = null;

function fonts(): Promise<SatoriFont[]> {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async (spec) => ({
      name: spec.name,
      data: await readFile(require.resolve(spec.file)),
      weight: spec.weight,
      style: spec.style,
    })),
  );
  return fontsPromise;
}

// A tiny element builder: satori takes React-shaped objects, and the API has no JSX.
type Style = Record<string, string | number>;
interface Node {
  readonly type: string;
  readonly props: {
    style?: Style;
    children?: Child;
    src?: string;
    width?: number;
    height?: number;
  };
}
type Child = Node | string | readonly (Node | string | null)[] | null;

const el = (type: string, style: Style, children: Child = null): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children },
});
const text = (style: Style, value: string): Node => el('div', style, value);

const MARK_SVG = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 30"><g fill="${fill}"><polygon points="7,0 31,0 25,8 1,8"/><polygon points="11,11 35,11 29,19 5,19"/><polygon points="9,22 33,22 27,30 3,30" opacity="0.75"/></g></svg>`,
  )}`;

const PAD = 72;

function header(context: CardContext, credit: string | null): Node {
  return el('div', { flexDirection: 'column', gap: 14 }, [
    el('div', { justifyContent: 'space-between', alignItems: 'center' }, [
      el('div', { alignItems: 'center', gap: 16 }, [
        {
          type: 'img',
          props: { src: MARK_SVG(C.ink), width: 50, height: 42, style: { display: 'flex' } },
        },
        text(
          { fontFamily: 'Caslon', fontSize: 46, letterSpacing: 5, color: C.ink, lineHeight: 1 },
          'NALARA',
        ),
      ]),
      text(
        {
          fontFamily: 'Courier',
          fontWeight: 700,
          fontSize: 26,
          color: C.manilaInk,
          backgroundColor: C.manila,
          padding: '10px 22px 8px',
          borderRadius: '6px 6px 0 0',
        },
        context.topic,
      ),
    ]),
    credit === null
      ? null
      : el('div', { justifyContent: 'flex-end' }, [
          text({ fontFamily: 'Courier', fontSize: 20, color: C.muted }, credit),
        ]),
  ]);
}

function footer(context: CardContext, right: string | null): Node {
  const left = [context.dateLabel, context.evidenceLine]
    .filter((part) => part !== null)
    .join(' / ');
  return el(
    'div',
    {
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 26,
      borderTop: `1px solid ${C.rule}`,
      fontFamily: 'Courier',
      fontSize: 27,
      color: C.muted,
      gap: 24,
    },
    [
      text({ flexShrink: 1 }, left),
      right === null ? null : text({ color: C.accent, fontWeight: 700, flexShrink: 0 }, right),
    ],
  );
}

function counter(index: number, total: number): Node {
  const pad = (n: number) => String(n).padStart(2, '0');
  return text(
    { fontFamily: 'Courier', fontWeight: 700, fontSize: 30, color: C.accent, marginBottom: 22 },
    `${pad(index + 1)}/${pad(total)}`,
  );
}

function stamp(label: string): Node {
  return el(
    'div',
    {
      alignSelf: 'flex-start',
      border: `4px solid ${C.stamp}`,
      borderRadius: 6,
      padding: 5,
      transform: 'rotate(-4deg)',
      marginTop: 34,
      marginLeft: 6,
    },
    [
      text(
        {
          border: `2px solid ${C.stamp}`,
          borderRadius: 3,
          padding: '10px 22px 8px',
          fontFamily: 'Courier',
          fontWeight: 700,
          fontSize: 32,
          letterSpacing: 4,
          color: C.stamp,
        },
        label.toUpperCase(),
      ),
    ],
  );
}

const titleSize = (title: string) => (title.length > 80 ? 64 : title.length > 50 ? 76 : 88);

function body(
  slide: Slide,
  index: number,
  total: number,
  image: string | null,
): { content: Node; right: string | null } {
  switch (slide.kind) {
    case 'cover':
      return {
        right: total > 1 ? 'Geser untuk lanjut' : null,
        content: el('div', { flexDirection: 'column', justifyContent: 'flex-end', flexGrow: 1 }, [
          text(
            {
              fontFamily: 'CaslonText',
              fontWeight: 700,
              fontSize: titleSize(slide.title),
              lineHeight: 1.08,
              letterSpacing: -1,
              color: C.ink,
            },
            slide.title,
          ),
          el('div', { width: 90, height: 4, backgroundColor: C.gold, marginTop: 30 }),
          slide.dek === ''
            ? null
            : text(
                {
                  fontFamily: 'Literata',
                  fontSize: 34,
                  lineHeight: 1.45,
                  color: C.muted,
                  marginTop: 26,
                },
                slide.dek,
              ),
          slide.verification === '' ? null : stamp(slide.verification),
          image === null ? null : el('div', { height: 8 }),
        ]),
      };
    case 'stat':
      return {
        right: null,
        content: el('div', { flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }, [
          counter(index, total),
          text(
            {
              fontFamily: 'Literata',
              fontWeight: 700,
              fontSize: 44,
              color: C.ink,
              lineHeight: 1.25,
            },
            slide.label,
          ),
          el('div', { alignItems: 'baseline', flexWrap: 'wrap', gap: 24, marginTop: 18 }, [
            text(
              {
                fontFamily: 'Caslon',
                fontSize: slide.value.length > 6 ? 170 : 230,
                color: C.ink,
                lineHeight: 1,
              },
              slide.value,
            ),
            text(
              { fontFamily: 'Caslon', fontSize: 76, color: C.accent, lineHeight: 1 },
              slide.unit,
            ),
          ]),
          text(
            { fontFamily: 'Courier', fontSize: 30, color: C.muted, marginTop: 30 },
            `Periode: ${slide.period}`,
          ),
          slide.source === ''
            ? null
            : text(
                {
                  fontFamily: 'Courier',
                  fontWeight: 700,
                  fontSize: 30,
                  color: C.ink,
                  marginTop: 10,
                },
                slide.source,
              ),
        ]),
      };
    case 'point':
      return {
        right: null,
        content: el('div', { flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }, [
          counter(index, total),
          text(
            {
              fontFamily: 'CaslonText',
              fontWeight: 700,
              fontSize: 72,
              lineHeight: 1.08,
              color: C.ink,
              marginBottom: 34,
            },
            slide.heading,
          ),
          text({ fontFamily: 'Literata', fontSize: 40, lineHeight: 1.5, color: C.ink }, slide.text),
        ]),
      };
    case 'quote':
      return {
        right: null,
        content: el('div', { flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }, [
          counter(index, total),
          text(
            { fontFamily: 'Caslon', fontSize: 220, lineHeight: 0.8, color: C.accent, height: 130 },
            '“',
          ),
          text(
            {
              fontFamily: 'Literata',
              fontStyle: 'italic',
              fontSize: 50,
              lineHeight: 1.4,
              color: C.ink,
            },
            slide.text,
          ),
          text(
            {
              fontFamily: 'Courier',
              fontWeight: 700,
              fontSize: 30,
              color: C.accent,
              marginTop: 34,
            },
            slide.attribution,
          ),
        ]),
      };
    case 'evidence':
      return {
        right: null,
        content: el('div', { flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }, [
          counter(index, total),
          text(
            {
              fontFamily: 'CaslonText',
              fontWeight: 700,
              fontSize: 76,
              color: C.ink,
              lineHeight: 1,
              marginBottom: 18,
            },
            'Barang bukti',
          ),
          text(
            {
              fontFamily: 'Literata',
              fontStyle: 'italic',
              fontSize: 32,
              color: C.muted,
              marginBottom: 36,
              lineHeight: 1.4,
            },
            'Sumber yang kami buka dan cocokkan sendiri. Silakan cek.',
          ),
          el(
            'div',
            { flexDirection: 'column', gap: 18 },
            slide.items.map((item, itemIndex) =>
              el(
                'div',
                {
                  flexDirection: 'column',
                  backgroundColor: C.manila,
                  padding: '20px 30px 20px 74px',
                  borderRadius: 6,
                  position: 'relative',
                },
                [
                  el('div', {
                    position: 'absolute',
                    left: 26,
                    top: 30,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: C.paper,
                  }),
                  text(
                    { fontFamily: 'Courier', fontWeight: 700, fontSize: 24, color: C.accent },
                    `Bukti ${String(itemIndex + 1)}`,
                  ),
                  text(
                    { fontFamily: 'Literata', fontWeight: 700, fontSize: 34, color: C.manilaInk },
                    item.publisher,
                  ),
                  item.title === ''
                    ? null
                    : text(
                        { fontFamily: 'Literata', fontSize: 26, color: C.muted, lineHeight: 1.35 },
                        item.title,
                      ),
                ],
              ),
            ),
          ),
          slide.more > 0
            ? text(
                { fontFamily: 'Courier', fontSize: 26, color: C.muted, marginTop: 16 },
                `dan ${String(slide.more)} sumber lainnya`,
              )
            : null,
          text(
            {
              fontFamily: 'Courier',
              fontWeight: 700,
              fontSize: 30,
              color: C.accent,
              marginTop: 40,
              marginRight: 230,
            },
            `Baca lengkap: ${slide.link}`,
          ),
        ]),
      };
  }
}

/** One card as an element tree (exported for tests). */
export function cardTree(
  slide: Slide,
  index: number,
  total: number,
  context: CardContext,
  image: string | null,
  mascot: string | null = null,
): Node {
  const credit = slide.kind === 'cover' ? slide.credit : null;
  const { content, right } = body(slide, index, total, image);
  const layers: (Node | null)[] = [];
  if (image !== null) {
    layers.push(
      {
        type: 'img',
        props: {
          src: image,
          width: CARD_WIDTH,
          height: 820,
          style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
        },
      },
      el('div', {
        position: 'absolute',
        top: 0,
        left: 0,
        width: CARD_WIDTH,
        height: 830,
        backgroundImage: `linear-gradient(180deg, rgba(231,224,217,0.6) 0%, rgba(231,224,217,0.1) 35%, ${C.paper} 100%)`,
      }),
    );
  }
  layers.push(
    el(
      'div',
      {
        position: 'absolute',
        top: PAD,
        left: PAD,
        width: CARD_WIDTH - 2 * PAD,
        height: CARD_HEIGHT - 2 * PAD,
        flexDirection: 'column',
        gap: 32,
      },
      [header(context, credit), content, footer(context, right)],
    ),
  );
  if (mascot !== null && slide.kind === 'evidence') {
    // Rana explaining, standing on the footer rule, beside the "read more" line.
    layers.push({
      type: 'img',
      props: {
        src: mascot,
        width: 190,
        height: 211,
        style: { position: 'absolute', right: PAD, bottom: PAD + 78 },
      },
    });
  }
  return el(
    'div',
    { width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: C.paper, position: 'relative' },
    layers,
  );
}

/** PNG bytes for one card. `image` is a data: URI of a licensed PNG/JPEG, or null. */
export async function renderCard(
  slide: Slide,
  index: number,
  total: number,
  context: CardContext,
  image: string | null,
): Promise<Buffer> {
  // satori's element type is React's; this tree has the same shape without React.
  const mascot = slide.kind === 'evidence' ? await rana() : null;
  const tree = cardTree(slide, index, total, context, image, mascot) as unknown as Parameters<
    typeof satori
  >[0];
  const svg = await satori(tree, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: await fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng();
}
