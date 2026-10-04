import { BadRequestException } from '@nestjs/common';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XElement, Node as XNode } from '@xmldom/xmldom';

// Venue drawings (Phase 17, docs/seating.md, "Venue drawings").
//
// An admin draws a venue in Figma, Inkscape, Illustrator… and uploads it as
// SVG. Every section's shape goes in a group called "sections" and is named
// after the section ("Section 5A", "VIP Green"). This file reads those
// names and turns the upload into SVG that is safe to put straight into a
// web page: only drawing elements and attributes survive, links can only
// point inside the drawing, and CSS is kept to the drawing. No scripts,
// event handlers, outside files or foreign content get through.

export const MAX_DRAWING_BYTES = 1024 * 1024;
export const MAX_SECTIONS = 500;

export interface DrawingSection {
  key: string; // lower-cased name; matches VenueSection.mapKey
  name: string;
}

export interface CleanDrawing {
  svg: string;
  sections: DrawingSection[];
  unnamed: number; // shapes in "sections" with no real name, left as drawing
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'symbol',
  'use', 'image', 'style',
]);
// Things that can be a section (a group = a shape plus its label, say).
const SECTION_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'g', 'use']);

const ATTRIBUTES = new Set([
  'id', 'class', 'style', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'width', 'height', 'points', 'transform', 'viewBox', 'preserveAspectRatio',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'color',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'letter-spacing',
  'word-spacing', 'text-anchor', 'text-decoration', 'dominant-baseline', 'alignment-baseline', 'baseline-shift',
  'writing-mode', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'clip-path', 'clipPathUnits', 'clip-rule', 'mask', 'maskUnits', 'maskContentUnits', 'visibility', 'display',
  'paint-order', 'vector-effect', 'shape-rendering', 'text-rendering', 'image-rendering', 'overflow',
  'data-name', 'data-bt-section', 'href', 'space',
]);

const CSS_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'color',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration', 'dominant-baseline', 'alignment-baseline',
  'baseline-shift', 'writing-mode', 'stop-color', 'stop-opacity', 'clip-path', 'clip-rule', 'mask', 'visibility',
  'display', 'paint-order', 'vector-effect', 'shape-rendering', 'text-rendering', 'mix-blend-mode', 'isolation',
]);

const RASTER_DATA_URI = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const DANGER = /javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding|\\/i;
const ID_PREFIX = 'bt-';

// Names editors give shapes on their own ("Rectangle 12", "path381",
// "Group 3"): not section names.
const DEFAULT_NAME = /^(path|rect|rectangle|circle|ellipse|polygon|polyline|line|g|group|layer|vector|shape|use|object|frame|union|subtract|intersect|exclude)[\s_-]*\d*$/i;

const isElement = (n: XNode | null): n is XElement => !!n && n.nodeType === 1;
const children = (el: XNode): XNode[] => {
  const out: XNode[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

/** "Section_5A", "_x31_A", "bt-VIP_Green" → "Section 5A", "1A", "VIP Green". */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return '';
  const decoded = raw
    .replace(/^bt-/, '')
    .replace(/_x([0-9a-f]{2,4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return decoded.slice(0, 100);
}

export const sectionKey = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/** The name an editor gave an element: Illustrator's data-name, Inkscape's label, else its id. */
function nameOf(el: XElement): string {
  const label = el.getAttribute('data-name') || el.getAttributeNS(INKSCAPE_NS, 'label') || el.getAttribute('inkscape:label') || el.getAttribute('id');
  return cleanName(label);
}

/** "Section 5A" or "5A" → "Gate 5": a section's number is its gate. */
export function gateFromName(name: string): string | null {
  const m = /^(?:section\s+)?(\d{1,3})\s*[a-z]?$/i.exec(name.trim());
  return m ? `Gate ${Number(m[1])}` : null;
}

function cleanDeclarations(text: string): string {
  const kept: string[] = [];
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (!CSS_PROPERTIES.has(prop) || !value || DANGER.test(value)) continue;
    if (/url\s*\(/i.test(value) && !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)/i.test(value.replace(/^.*?(url\()/i, '$1'))) continue;
    kept.push(`${prop}:${rewriteRefs(value)}`);
  }
  return kept.join(';');
}

// CSS from <style> elements would otherwise style the whole page the map
// sits in, so every rule is scoped to the drawing. At-rules are dropped.
function cleanCss(css: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // @import never belongs in a drawing; escapes could hide anything.
  if (/@import|javascript:|expression\s*\(|behavior\s*:|-moz-binding|\\/i.test(text)) return '';
  const rules: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].trim();
    if (!selectors || selectors.startsWith('@') || selectors.includes('<')) continue;
    const body = cleanDeclarations(m[2]);
    if (!body) continue;
    const scoped = selectors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `[data-bt-map] ${s}`)
      .join(', ');
    rules.push(`${scoped}{${body}}`);
  }
  return rules.join('\n');
}

// Ids are prefixed so they can't clash with the page's own ids; references
// to them (url(#a), href="#a") are rewritten to match.
function prefixId(id: string) {
  return id.startsWith(ID_PREFIX) ? id : ID_PREFIX + id;
}
function rewriteRefs(value: string) {
  return value.replace(/url\(\s*(['"]?)#([\w.-]+)\1\s*\)/g, (_, _q: string, id: string) => `url(#${prefixId(id)})`);
}

function cleanAttributes(el: XElement) {
  const tag = el.localName;
  const attrs: { name: string; local: string; ns: string | null; value: string }[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i)!;
    attrs.push({ name: a.name, local: a.localName ?? a.name, ns: a.namespaceURI, value: a.value });
  }
  for (const a of attrs) el.removeAttributeNode(el.getAttributeNode(a.name)!);

  for (const a of attrs) {
    const local = a.local;
    let value = a.value;
    if (a.ns && a.ns !== XLINK_NS && a.ns !== XML_NS) continue; // inkscape:*, sodipodi:*, xmlns:*
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    if (/^on/i.test(local) || !ATTRIBUTES.has(local)) continue;
    if (local === 'href') {
      const ok = value.startsWith('#') ? true : tag === 'image' && RASTER_DATA_URI.test(value);
      if (!ok) continue;
      if (value.startsWith('#')) value = '#' + prefixId(value.slice(1));
      el.setAttribute('href', value);
      continue;
    }
    if (local === 'space') {
      if (a.ns === XML_NS) el.setAttributeNS(XML_NS, 'xml:space', value === 'preserve' ? 'preserve' : 'default');
      continue;
    }
    if (DANGER.test(value)) continue;
    if (local === 'style') {
      const css = cleanDeclarations(value);
      if (css) el.setAttribute('style', css);
      continue;
    }
    if (/url\s*\(/i.test(value)) {
      if (!/^\s*url\(\s*['"]?#[\w.-]+['"]?\s*\)\s*$/i.test(value)) continue;
      value = rewriteRefs(value);
    }
    if (local === 'id') value = prefixId(value);
    el.setAttribute(local, value);
  }
}

function cleanTree(el: XElement) {
  cleanAttributes(el);
  for (const child of children(el)) {
    if (isElement(child)) {
      const tag = child.localName;
      const ns = child.namespaceURI;
      if ((ns && ns !== SVG_NS) || !tag || !ELEMENTS.has(tag)) {
        el.removeChild(child);
        continue;
      }
      if (tag === 'style') {
        const css = cleanCss(child.textContent ?? '');
        for (const c of children(child)) child.removeChild(c);
        for (let i = child.attributes.length - 1; i >= 0; i--) child.removeAttributeNode(child.attributes.item(i)!);
        if (!css) el.removeChild(child);
        else child.appendChild(child.ownerDocument!.createTextNode(css));
        continue;
      }
      if (tag === 'image') {
        const href = child.getAttribute('href') || child.getAttributeNS(XLINK_NS, 'href') || '';
        if (!RASTER_DATA_URI.test(href)) {
          el.removeChild(child);
          continue;
        }
      }
      cleanTree(child);
    } else if (child.nodeType === 3) {
      // text: kept
    } else if (child.nodeType === 4) {
      // CDATA outside <style>: keep its text as plain text
      el.replaceChild(el.ownerDocument!.createTextNode(child.nodeValue ?? ''), child);
    } else {
      el.removeChild(child); // comments, processing instructions
    }
  }
}

function findSectionsGroup(el: XElement): XElement | null {
  for (const child of children(el)) {
    if (!isElement(child)) continue;
    if ((child.localName === 'g' || child.localName === 'svg') && sectionKey(nameOf(child)) === 'sections') return child;
    const inner = findSectionsGroup(child);
    if (inner) return inner;
  }
  return null;
}

/**
 * Reads an uploaded venue drawing. Throws a BadRequestException with a
 * message an admin can act on when the file can't be used.
 */
export function readDrawing(text: string): CleanDrawing {
  if (Buffer.byteLength(text, 'utf8') > MAX_DRAWING_BYTES) {
    throw new BadRequestException('The drawing is over 1 MB. Simplify it or remove pictures from it.');
  }
  if (/<!ENTITY/i.test(text)) throw new BadRequestException('The drawing has entity declarations. Export it again as plain SVG.');

  let doc;
  const problems: string[] = [];
  try {
    doc = new DOMParser({
      onError: (level: string, msg: string) => {
        if (level !== 'warning') problems.push(msg);
      },
    }).parseFromString(text, 'image/svg+xml');
  } catch {
    throw new BadRequestException('This file isn’t a readable SVG. Export it again as SVG.');
  }
  const root = doc?.documentElement;
  if (!root || problems.length || root.localName !== 'svg') {
    throw new BadRequestException('This file isn’t a readable SVG. Export it again as SVG.');
  }

  // The drawing must say how big it is, so it can scale to any screen.
  let viewBox = root.getAttribute('viewBox');
  if (!viewBox) {
    const w = parseFloat(root.getAttribute('width') ?? '');
    const h = parseFloat(root.getAttribute('height') ?? '');
    if (!(w > 0 && h > 0)) throw new BadRequestException('The drawing has no size. Export it again with a width and height.');
    viewBox = `0 0 ${w} ${h}`;
  }

  const group = findSectionsGroup(root);
  if (!group) throw new BadRequestException('No group called “sections” in the drawing. Put the section shapes in a group with that name.');

  // Every shape (or group) directly in "sections" is one section. Groups
  // with no real name (a stand's sections grouped together) are looked
  // inside.
  const sections: DrawingSection[] = [];
  const seen = new Map<string, string>();
  let unnamed = 0;
  const visit = (parent: XElement, depth: number) => {
    for (const child of children(parent)) {
      if (!isElement(child) || !SECTION_TAGS.has(child.localName ?? '')) continue;
      child.removeAttribute('data-bt-section');
      const name = nameOf(child);
      if (!name || DEFAULT_NAME.test(name)) {
        if (child.localName === 'g' && depth < 3) visit(child, depth + 1);
        else unnamed++;
        continue;
      }
      const key = sectionKey(name);
      if (seen.has(key)) throw new BadRequestException(`Two shapes are called “${name}”. Give each section its own name.`);
      seen.set(key, name);
      sections.push({ key, name });
      child.setAttribute('data-bt-section', key);
      child.setAttribute('data-name', name);
    }
  };
  visit(group, 0);
  if (sections.length === 0) throw new BadRequestException('The “sections” group has no named shapes. Name each section’s shape.');
  if (sections.length > MAX_SECTIONS) throw new BadRequestException(`The drawing has ${sections.length} sections; the most is ${MAX_SECTIONS}.`);

  cleanTree(root);
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('viewBox', viewBox.replace(/[^\d.\s,-]/g, '').trim());
  root.setAttribute('data-bt-map', '');

  const svg = new XMLSerializer().serializeToString(root);
  return { svg, sections, unnamed };
}
