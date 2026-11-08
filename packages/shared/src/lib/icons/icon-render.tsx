/**
 * icon-render.tsx — safe SVG rendering of local icon data.
 *
 * Iconify icon data is provided as an inner SVG body string (paths/groups).
 * We render it inside a React <svg> we fully control, using a small, strict
 * allowlist parser that only accepts the tags/attributes Iconify emits and
 * DROPS everything else (no script, no foreignObject, no event handlers).
 * This avoids dangerouslySetInnerHTML on un-trusted input.
 *
 * The icon body comes from locally generated, vetted data (icon-loader), so the
 * allowlist is defense-in-depth rather than the only safeguard.
 */
import { Fragment, useMemo, createElement } from "react";
import type { ReactNode } from "react";
import type { IconBodyData } from "./icon-types";

// Tags Iconify may emit inside an icon body. Anything else is dropped.
const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "use",
  "clipPath",
]);

// Attributes permitted on an allowed tag (no on*, no script, no href to external).
const ALLOWED_ATTRS = new Set([
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "transform",
  "clip-path",
  "points",
  "viewbox",
]);

const ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/i;

interface Token {
  tag: string;
  attrs: Record<string, string>;
  children: string[] | Token[];
}

/**
 * Minimal, strict SVG subset parser. Returns a tiny element tree.
 * Non-allowed tags/attributes are dropped; malformed input is skipped.
 * This is NOT a general XML parser — deliberately limited to the icon corpus.
 */
function parseBody(body: string): Token[] {
  if (!body || typeof body !== "string") return [];

  const stack: Token[] = [];
  const roots: Token[] = [];
  let i = 0;

  const pushSibling = (tok: Token) => {
    const parent = stack[stack.length - 1];
    if (parent && parent.children && typeof parent.children[0] !== "string") {
      (parent.children as Token[]).push(tok);
    } else {
      roots.push(tok);
    }
  };

  outer: while (i < body.length) {
    const lt = body.indexOf("<", i);
    if (lt === -1) break;
    i = lt + 1;

    // Comments <!-- --> skip
    if (body.startsWith("!--", i)) {
      const end = body.indexOf("-->", i);
      i = end === -1 ? body.length : end + 3;
      continue;
    }
    // Closing tag </...>
    if (body[i] === "/") {
      const gt = body.indexOf(">", i);
      i = gt === -1 ? body.length : gt + 1;
      if (stack.length) {
        const closed = stack.pop();
        if (closed && stack.length === 0) roots.push(closed);
      }
      continue;
    }

    // Parse tag name
    let j = i;
    while (j < body.length && /[A-Za-z0-9:_-]/.test(body[j])) j++;
    const tagName = body.slice(i, j);
    i = j;
    if (!tagName) continue;

    // Parse attributes
    const attrs: Record<string, string> = {};
    for (;;) {
      // skip whitespace
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] === undefined) break outer;
      if (body[i] === "/") {
        if (body[i + 1] === ">") {
          i += 2;
          const tok: Token = { tag: tagName, attrs, children: [] };
          pushSibling(tok);
          continue outer;
        }
        i++;
        continue;
      }
      if (body[i] === ">") {
        i++;
        break;
      }
      // attr name
      let an = i;
      while (an < body.length && /[A-Za-z0-9:_-]/.test(body[an])) an++;
      const attrName = body.slice(i, an);
      i = an;
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] !== "=") continue;
      i++; // skip =
      while (i < body.length && /\s/.test(body[i])) i++;
      const quote = body[i];
      let val = "";
      if (quote === '"' || quote === "'") {
        i++;
        const vs = i;
        const ve = body.indexOf(quote, i);
        if (ve === -1) {
          val = body.slice(vs);
          i = body.length;
        } else {
          val = body.slice(vs, ve);
          i = ve + 1;
        }
      } else {
        let vs = i;
        while (i < body.length && !/[\s/>]/.test(body[i])) i++;
        val = body.slice(vs, i);
      }
      if (attrName && ALLOWED_ATTRS.has(attrName.toLowerCase()) && ATTR_NAME_RE.test(attrName)) {
        attrs[attrName] = val;
      }
    }

    if (!ALLOWED_TAGS.has(tagName.toLowerCase())) continue;

    // Self-closing in source means no children follow.
    const tok: Token = { tag: tagName, attrs, children: [] };
    const isSelfClosing = body[i - 1] === "/" ? false : body[i - 1] === ">" && body.slice(0, i).trimEnd().endsWith("/");
    void isSelfClosing;
    if (body[i - 1] !== "/") {
      stack.push(tok);
      // If it's a void-ish tag (no closing) don't stack — but SVG tags always close.
    }
  }

  return roots;
}

/** Render a parsed token tree to React elements. */
function renderNode(tok: Token, keyPrefix: string): ReactNode {
  const tag = tok.tag.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return null;
  const children = tok.children
    .map((c, idx) => (typeof c === "string" ? c : renderNode(c, `${keyPrefix}-${idx}`)))
    .filter((n) => n !== null && n !== "");
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tok.attrs)) {
    const lk = k.toLowerCase();
    if (lk === "viewbox") props.viewBox = v;
    else if (lk === "fill" || lk === "stroke") props[lk] = v;
    else props[k] = v;
  }
  return createElement(tag, props, children);
}

export interface IconSvgProps {
  body?: IconBodyData | null;
  /** Fallback when no body (e.g. not loaded yet). */
  children?: ReactNode;
  className?: string;
  size?: number | string;
  title?: string;
}

/**
 * Renders a locally generated Iconify icon body as a real <svg>.
 * Uses the strict allowlist parser — no dangerouslySetInnerHTML.
 */
export function IconSvg({ body, children, className, size = "1em", title }: IconSvgProps) {
  const tree = useMemo(() => (body?.body ? parseBody(body.body) : []), [body?.body]);

  const w = body?.w ?? body?.h ?? 24;
  const h = body?.h ?? 24;
  const viewBox = `0 0 ${w} ${h}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {tree.map((t, i) => (
        <Fragment key={i}>{renderNode(t, `n${i}`)}</Fragment>
      ))}
      {children}
    </svg>
  );
}
