//! Tag extraction for the tags index: inline `#tag` / `#nested/tag` outside code, and
//! `tags:` / `tag:` in YAML front matter. Tags are case-insensitive and stored in
//! lower case. The same rules are implemented for editor highlighting in
//! src/lib/tags.ts; keep the two in sync.

use std::collections::BTreeSet;

use crate::links::{fence_marker, strip_inline_code};

/// All distinct tags of a note, lower-cased, sorted.
pub fn extract_tags(text: &str) -> Vec<String> {
    let mut tags = BTreeSet::new();
    let (front_matter, body_start_line) = front_matter(text);
    if let Some(fm) = front_matter {
        for tag in front_matter_tags(fm) {
            tags.insert(tag);
        }
    }

    let mut fence: Option<(char, usize)> = None;
    for line in text.lines().skip(body_start_line) {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
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
        for tag in inline_tags(&strip_inline_code(line)) {
            tags.insert(tag);
        }
    }
    tags.into_iter().collect()
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// Characters a tag's `#` may follow (besides the start of the line).
fn may_precede_tag(c: char) -> bool {
    c.is_whitespace() || c == '(' || c == ',' || c == ';'
}

/// Cleans a candidate tag; None when it is not a valid tag.
pub fn normalize_tag(raw: &str) -> Option<String> {
    let tag = raw.trim().trim_start_matches('#').trim_end_matches('/');
    if tag.is_empty() || tag.starts_with('/') || tag.contains("//") || !tag.chars().all(is_tag_char)
    {
        return None;
    }
    // At least one character that is not a digit: "#123" is not a tag.
    if tag
        .chars()
        .all(|c| c.is_ascii_digit() || c == '-' || c == '/')
    {
        return None;
    }
    Some(tag.to_lowercase())
}

/// `#tags` on a line (code already removed).
fn inline_tags(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '#' {
            i += 1;
            continue;
        }
        let prev = if i == 0 { None } else { Some(chars[i - 1]) };
        // "](#anchor)" is a link to a heading, not a tag.
        let after_link = i >= 2 && chars[i - 2] == ']' && chars[i - 1] == '(';
        let starts_ok = prev.map_or(true, may_precede_tag) && !after_link;
        let end = chars[i + 1..]
            .iter()
            .position(|&c| !is_tag_char(c))
            .map_or(chars.len(), |p| i + 1 + p);
        if starts_ok && end > i + 1 {
            let raw: String = chars[i + 1..end].iter().collect();
            if let Some(tag) = normalize_tag(&raw) {
                out.push(tag);
            }
        }
        i = end.max(i + 1);
    }
    out
}

/// The YAML front matter block (between the opening `---` and the closing `---` or
/// `...`) and the line index where the body starts. None when there is none.
fn front_matter(text: &str) -> (Option<&str>, usize) {
    let mut lines = text.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return (None, 0);
    };
    if first.trim_end() != "---" {
        return (None, 0);
    }
    let start = first.len();
    let mut offset = start;
    for (n, line) in lines.enumerate() {
        let t = line.trim_end();
        if t == "---" || t == "..." {
            return (Some(&text[start..offset]), n + 2);
        }
        offset += line.len();
    }
    (None, 0)
}

/// Tags from the `tags:` / `tag:` key of front matter: `[a, b]`, `a, b`, `a b`, or a
/// `- item` list on the following lines.
fn front_matter_tags(fm: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_list = false;
    for line in fm.lines() {
        if in_list {
            if let Some(item) = line.trim_start().strip_prefix("- ") {
                out.extend(normalize_tag(unquote(item)));
                continue;
            }
            if line.starts_with([' ', '\t']) || line.trim().is_empty() {
                continue;
            }
            in_list = false;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_lowercase();
        if key != "tags" && key != "tag" {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            in_list = true;
            continue;
        }
        let inner = value.trim_start_matches('[').trim_end_matches(']');
        for part in inner.split([',', ' ']).filter(|p| !p.is_empty()) {
            out.extend(normalize_tag(unquote(part)));
        }
    }
    out
}

fn unquote(s: &str) -> &str {
    s.trim().trim_matches(|c| c == '"' || c == '\'')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_tags_and_boundaries() {
        assert_eq!(
            extract_tags("Plan #Work and #work/Q3, (#idea) #ý-tưởng\n#start of line"),
            ["idea", "start", "work", "work/q3", "ý-tưởng"]
        );
        // Not tags: inside words, URLs, anchors, escapes, numbers, headings.
        assert!(extract_tags(
            "a#b https://x.y/#frag [h](#anchor) \\#esc #123 #1-2 # Heading\n## Sub"
        )
        .is_empty());
    }

    #[test]
    fn code_is_skipped() {
        let text = "#real `#inline`\n```\n#fenced\n```\n~~~\n#tilde\n~~~\n#after";
        assert_eq!(extract_tags(text), ["after", "real"]);
    }

    #[test]
    fn trailing_slash_and_invalid_nesting() {
        assert_eq!(extract_tags("#a/b/ #/c #d//e"), ["a/b"]);
    }

    #[test]
    fn front_matter_forms() {
        let inline = "---\ntitle: X\ntags: [Alpha, \"beta\", '#Gamma']\n---\n#body";
        assert_eq!(extract_tags(inline), ["alpha", "beta", "body", "gamma"]);

        let list = "---\ntags:\n  - one\n  - two/sub\nother: 1\n---\ntext";
        assert_eq!(extract_tags(list), ["one", "two/sub"]);

        let plain = "---\ntag: solo, pair\n...\n";
        assert_eq!(extract_tags(plain), ["pair", "solo"]);

        // "#" in front matter values that are not tags is ignored.
        let other = "---\ntitle: Issue #5 #notatag\n---\n";
        assert!(extract_tags(other).is_empty());
    }

    #[test]
    fn unterminated_front_matter_is_body() {
        assert_eq!(extract_tags("---\n#a"), ["a"]);
    }

    #[test]
    fn normalize_tag_rules() {
        assert_eq!(normalize_tag("#Work/"), Some("work".into()));
        assert_eq!(normalize_tag("12"), None);
        assert_eq!(normalize_tag("a b"), None);
        assert_eq!(normalize_tag("2024-plan"), Some("2024-plan".into()));
    }
}
