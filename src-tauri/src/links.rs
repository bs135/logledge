//! Link extraction for the backlinks index: finds `[[WikiLinks]]` and Markdown links
//! to notes (`[text](other.md)`) in a note's text, outside code. Targets are stored as
//! written; resolving them to a note (current folder first, shortest path...) is done
//! by the frontend, which owns that logic (src/lib/wikilink.ts).

use serde::Serialize;

/// Longest context line kept per link, in characters.
const CONTEXT_MAX_CHARS: usize = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkKind {
    /// `[[Target]]`, `[[Target#Heading|Alias]]`: target is the text before `#`/`|`.
    Wiki,
    /// `[text](path/to/note.md)`: target is the decoded path, relative to the source note.
    Markdown,
}

impl LinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkKind::Wiki => "wiki",
            LinkKind::Markdown => "markdown",
        }
    }

    pub fn parse(s: &str) -> LinkKind {
        if s == "markdown" {
            LinkKind::Markdown
        } else {
            LinkKind::Wiki
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub target: String,
    pub kind: LinkKind,
    /// 1-based line number in the source note.
    pub line: u32,
    /// The source line, trimmed and shortened, shown as context.
    pub context: String,
}

/// Lookup key for a link target: its file name, lower-cased, without a Markdown
/// extension. Every note a target could resolve to has this key, so a backlinks
/// query only needs to look at links with the open note's key.
pub fn target_key(target: &str) -> String {
    let name = target.rsplit(['/', '\\']).next().unwrap_or(target).trim();
    let lower = name.to_lowercase();
    for ext in [".md", ".markdown"] {
        if let Some(stripped) = lower.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    lower
}

/// All note links in `text`, in document order. Fenced code blocks and inline code
/// spans are skipped; external URLs and same-note links (`[[#Heading]]`) are ignored.
pub fn extract_links(text: &str) -> Vec<Link> {
    let mut links = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for (idx, raw_line) in text.lines().enumerate() {
        let trimmed = raw_line.trim_start();
        let indent = raw_line.len() - trimmed.len();
        if let Some((ch, len)) = fence_marker(trimmed) {
            if indent <= 3 {
                match fence {
                    None => {
                        fence = Some((ch, len));
                        continue;
                    }
                    Some((open_ch, open_len)) if open_ch == ch && len >= open_len => {
                        fence = None;
                        continue;
                    }
                    _ => {}
                }
            }
        }
        if fence.is_some() {
            continue;
        }
        let line = strip_inline_code(raw_line);
        let context = shorten(raw_line.trim());
        let line_no = (idx + 1) as u32;
        for target in wiki_targets(&line) {
            links.push(Link {
                target,
                kind: LinkKind::Wiki,
                line: line_no,
                context: context.clone(),
            });
        }
        for target in markdown_note_targets(&line) {
            links.push(Link {
                target,
                kind: LinkKind::Markdown,
                line: line_no,
                context: context.clone(),
            });
        }
    }
    links
}

/// The fence character and run length when `line` opens or closes a fenced block.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let ch = line.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let len = line.chars().take_while(|&c| c == ch).count();
    (len >= 3).then_some((ch, len))
}

/// Replaces inline code spans (`` `x` ``, ``` ``x`` ```) with spaces so links inside
/// them are not found. An unmatched backtick run is kept as text.
fn strip_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '`' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let run = chars[i..].iter().take_while(|&&c| c == '`').count();
        // Find a closing run of exactly the same length.
        let mut j = i + run;
        let mut close = None;
        while j < chars.len() {
            if chars[j] == '`' {
                let r = chars[j..].iter().take_while(|&&c| c == '`').count();
                if r == run {
                    close = Some(j);
                    break;
                }
                j += r;
            } else {
                j += 1;
            }
        }
        match close {
            Some(end) => {
                out.extend(std::iter::repeat(' ').take(end + run - i));
                i = end + run;
            }
            None => {
                out.extend(&chars[i..i + run]);
                i += run;
            }
        }
    }
    out
}

/// Targets of `[[...]]` on a line: the part before `#` and `|`, trimmed.
fn wiki_targets(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let inner = &after[..end];
        if !inner.contains('[') {
            let target = inner.split(['|', '#']).next().unwrap_or("").trim();
            if !target.is_empty() {
                out.push(target.replace('\\', "/"));
            }
            rest = &after[end + 2..];
        } else {
            // "[[a [[b]]": restart from the inner "[[".
            rest = &rest[start + 1..];
        }
    }
    out
}

/// Destinations of `[text](dest)` that point at a Markdown note: no URL scheme, not a
/// same-page anchor, ending in .md/.markdown once the anchor/query is removed. The
/// destination is percent-decoded; `<...>` brackets are removed.
fn markdown_note_targets(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(pos) = rest.find("](") {
        let after = &rest[pos + 2..];
        let (dest, consumed) = if let Some(inner) = after.strip_prefix('<') {
            match inner.find('>') {
                Some(end) => (&inner[..end], end + 2),
                None => break,
            }
        } else {
            let end = after
                .find(|c: char| c == ')' || c.is_whitespace())
                .unwrap_or(after.len());
            (&after[..end], end)
        };
        rest = &after[consumed..];
        let dest = dest.split(['#', '?']).next().unwrap_or("");
        if dest.is_empty() || dest.contains("://") || dest.starts_with("mailto:") {
            continue;
        }
        let decoded = percent_decode(dest);
        let lower = decoded.to_lowercase();
        if lower.ends_with(".md") || lower.ends_with(".markdown") {
            out.push(decoded.replace('\\', "/"));
        }
    }
    out
}

/// Decodes `%XX` escapes (UTF-8); invalid sequences are kept as written.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn shorten(line: &str) -> String {
    if line.chars().count() <= CONTEXT_MAX_CHARS {
        return line.to_string();
    }
    let mut s: String = line.chars().take(CONTEXT_MAX_CHARS).collect();
    s.push('…');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(text: &str) -> Vec<(String, LinkKind, u32)> {
        extract_links(text)
            .into_iter()
            .map(|l| (l.target, l.kind, l.line))
            .collect()
    }

    #[test]
    fn wiki_links_with_heading_and_alias() {
        let t = targets("See [[Roadmap]] and [[dir/Plan#Q3|the plan]].\n[[#Local]] [[ Spaced ]]");
        assert_eq!(
            t,
            vec![
                ("Roadmap".into(), LinkKind::Wiki, 1),
                ("dir/Plan".into(), LinkKind::Wiki, 1),
                ("Spaced".into(), LinkKind::Wiki, 2),
            ]
        );
    }

    #[test]
    fn markdown_links_to_notes_only() {
        let t = targets(
            "[a](notes/a.md) [b](../b.markdown#sec) [web](https://x.y/c.md) [img](pic.png) \
             [anchor](#top) [sp](my%20note.md) [ang](<with space.md>) [mail](mailto:a@b.md)",
        );
        let names: Vec<_> = t.into_iter().map(|(n, k, _)| (n, k)).collect();
        assert_eq!(
            names,
            vec![
                ("notes/a.md".into(), LinkKind::Markdown),
                ("../b.markdown".into(), LinkKind::Markdown),
                ("my note.md".into(), LinkKind::Markdown),
                ("with space.md".into(), LinkKind::Markdown),
            ]
        );
    }

    #[test]
    fn code_is_skipped() {
        let text = "real [[A]]\n```\n[[InFence]]\n```\n`[[Inline]]` and ``x [[Double]] x`` [[B]]\n~~~md\n[[Tilde]]\n~~~\n[[C]]";
        let names: Vec<_> = targets(text).into_iter().map(|(n, _, l)| (n, l)).collect();
        assert_eq!(
            names,
            vec![("A".into(), 1), ("B".into(), 5), ("C".into(), 9)]
        );
    }

    #[test]
    fn unclosed_backtick_does_not_hide_links() {
        assert_eq!(targets("it`s [[A]]").len(), 1);
    }

    #[test]
    fn context_is_trimmed_line() {
        let links = extract_links("  - item with [[A]]  ");
        assert_eq!(links[0].context, "- item with [[A]]");
        let long = format!("[[A]] {}", "x".repeat(400));
        assert!(extract_links(&long)[0].context.ends_with('…'));
    }

    #[test]
    fn target_key_is_lowercase_file_name_without_md() {
        assert_eq!(target_key("Dir/Sub/My Note.md"), "my note");
        assert_eq!(target_key("Roadmap"), "roadmap");
        assert_eq!(target_key("a.markdown"), "a");
        assert_eq!(target_key("img/pic.png"), "pic.png");
        assert_eq!(target_key("v1.2 notes"), "v1.2 notes");
    }

    #[test]
    fn percent_decode_utf8_and_invalid() {
        assert_eq!(percent_decode("Vi%E1%BB%87t.md"), "Việt.md");
        assert_eq!(percent_decode("100%.md"), "100%.md");
        assert_eq!(percent_decode("a%2"), "a%2");
    }
}
