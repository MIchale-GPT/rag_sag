import type { Citation } from "./types";
import { clientErrorMessage } from "../i18n/client-errors";

// Tool content may contain OpenAI's private-use citation delimiters
// (`\uE200cite\uE202turn…\uE201`) or lossy square/replacement variants.
// These are transport markers, not readable source content.
const RAW_CITATION_TOKEN =
  /[\ue200\u25a1\ufffd]?cite(?:[\ue202\u25a1\ufffd]?turn[a-z0-9]+)+[\ue201\u25a1\ufffd]?/gi;

export interface CitationCopy {
  mode: "event" | "external" | "source_only";
  title: string;
  summary: string;
  meta: string;
  excerpt: string;
}

export function stripCitationTransportTokens(value: string | null | undefined): string {
  return (value ?? "")
    .replace(RAW_CITATION_TOKEN, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+(?=\n)/g, "")
    .trim();
}

export function cleanCitationText(value: string | null | undefined): string {
  return stripCitationTransportTokens(value)
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function internalMeta(citation: Citation): string {
  const source = cleanCitationText(citation.source_name);
  const heading = cleanCitationText(citation.heading);
  const parts: string[] = [];
  if (source) parts.push(source);
  if (heading && (!source || !sameText(source, heading))) {
    parts.push(clientErrorMessage("citationSection", { heading }));
  }
  return parts.join(" · ");
}

function externalHostname(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function externalMeta(citation: Citation, title: string): string {
  const source = cleanCitationText(citation.source);
  const domain = externalHostname(citation.url);
  const parts: string[] = [];
  if (source && !sameText(source, title)) parts.push(source);
  if (
    domain
    && !sameText(domain, title)
    && (!source || !sameText(domain, source))
  ) {
    parts.push(domain);
  }
  return parts.join(" · ");
}

/**
 * Present citation fields without assigning event semantics to retrieved text.
 * Only `event_refs[0]` may provide an internal event title/summary. The source
 * excerpt is kept intact for the explicit, initially-collapsed excerpt view.
 */
export function citationCopy(citation: Citation, fallbackIndex: number): CitationCopy {
  const excerpt = cleanCitationText(citation.snippet);

  if (citation.kind === "external") {
    const source = cleanCitationText(citation.source);
    const domain = externalHostname(citation.url);
    const title = cleanCitationText(citation.title)
      || source
      || domain
      || clientErrorMessage("externalSource", { index: fallbackIndex });
    return {
      mode: "external",
      title,
      summary: cleanCitationText(citation.summary),
      meta: externalMeta(citation, title),
      excerpt,
    };
  }

  const event = citation.event_refs?.[0];
  const eventTitle = cleanCitationText(event?.title);
  if (eventTitle) {
    return {
      mode: "event",
      title: eventTitle,
      summary: cleanCitationText(event?.summary),
      meta: "",
      excerpt,
    };
  }

  const number = Number.isInteger(citation.n) && citation.n > 0 ? citation.n : fallbackIndex;
  return {
    mode: "source_only",
    title: clientErrorMessage("knowledgeSource", { index: number }),
    summary: "",
    meta: internalMeta(citation),
    excerpt,
  };
}
