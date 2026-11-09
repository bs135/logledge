//! Exact search and replace inside notes (Global Search's case-sensitive / regex /
//! replace modes). Works line by line, so the matches shown in the preview are exactly
//! the ones a replace changes. Pure functions; reading and writing files is up to the
//! callers.

use regex::{NoExpand, Regex, RegexBuilder};
use serde::Serialize;

use crate::error::{Error, Result};

/// Longest line text sent to the frontend, in characters (matches beyond it are still
/// counted and replaced, just not shown).
const LINE_TEXT_MAX_CHARS: usize = 400;

#[derive(Debug, Clone, Copy, Default)]
pub struct GrepOptions {
    pub case_sensitive: bool,
    /// The query is a regular expression (Rust `regex` syntax) instead of plain text.
    pub regex: bool,
    /// Match whole words only (Unicode word boundaries).
    pub whole_word: bool,
}

/// One line containing matches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    /// 1-based line number.
    pub line: u32,
    /// The line (shortened when very long).
    pub text: String,
    /// Match ranges in `text` as [start, end) offsets in UTF-16 code units (JS string
    /// indexes).
    pub ranges: Vec<[u32; 2]>,
}

/// Builds the matcher for a query. Errors when the regex is invalid or when it can
/// match empty text (replacing such matches would insert text everywhere).
pub fn build_pattern(query: &str, opts: GrepOptions) -> Result<Regex> {
    if query.is_empty() {
        return Err(Error::msg("empty search"));
    }
    let mut source = if opts.regex {
        format!("(?:{query})")
    } else {
        regex::escape(query)
    };
    if opts.whole_word {
        // Plain text: a boundary only on a side that starts/ends with a word character,
        // so "#tag" or "a.b." still match (as in VS Code). Regex: both sides.
        let is_word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        if opts.regex || is_word(query.chars().next()) {
            source.insert_str(0, r"\b");
        }
        if opts.regex || is_word(query.chars().last()) {
            source.push_str(r"\b");
        }
    }
    let re = RegexBuilder::new(&source)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| Error::msg(format!("invalid regular expression: {e}")))?;
    if re.is_match("") {
        return Err(Error::msg("the pattern matches empty text"));
    }
    Ok(re)
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Lines of `text` with at least one match (in order, at most `max_lines`), the total
/// number of matches and the number of lines with matches (both counting everything).
pub fn grep_text(re: &Regex, text: &str, max_lines: usize) -> (Vec<LineMatch>, u32, usize) {
    let mut lines = Vec::new();
    let mut total = 0u32;
    let mut matching_lines = 0usize;
    for (idx, line) in text.lines().enumerate() {
        let mut ranges = Vec::new();
        let shown_end = line
            .char_indices()
            .nth(LINE_TEXT_MAX_CHARS)
            .map_or(line.len(), |(b, _)| b);
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            total += 1;
            if m.end() <= shown_end {
                ranges.push([utf16_len(&line[..m.start()]), utf16_len(&line[..m.end()])]);
            }
        }
        if ranges.is_empty() && !re.is_match(line) {
            continue;
        }
        matching_lines += 1;
        if lines.len() < max_lines {
            let mut shown = line[..shown_end].to_string();
            if shown_end < line.len() {
                shown.push('…');
            }
            lines.push(LineMatch {
                line: (idx + 1) as u32,
                text: shown,
                ranges,
            });
        }
    }
    (lines, total, matching_lines)
}

/// Replaces every match in `text`, line by line (line endings are kept), and returns
/// the new text and the number of replacements. In regex mode `$1` / `${name}` in
/// `replacement` refer to capture groups; otherwise it is inserted literally.
pub fn replace_text(re: &Regex, text: &str, replacement: &str, opts: GrepOptions) -> (String, u32) {
    let mut out = String::with_capacity(text.len());
    let mut count = 0u32;
    for raw in text.split_inclusive('\n') {
        let (content, ending) = match raw.strip_suffix("\r\n") {
            Some(c) => (c, "\r\n"),
            None => match raw.strip_suffix('\n') {
                Some(c) => (c, "\n"),
                None => (raw, ""),
            },
        };
        let n = re
            .find_iter(content)
            .filter(|m| m.start() != m.end())
            .count() as u32;
        if n == 0 {
            out.push_str(raw);
            continue;
        }
        count += n;
        let replaced = if opts.regex {
            re.replace_all(content, replacement)
        } else {
            re.replace_all(content, NoExpand(replacement))
        };
        out.push_str(&replaced);
        out.push_str(ending);
    }
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: GrepOptions = GrepOptions {
        case_sensitive: false,
        regex: false,
        whole_word: false,
    };

    #[test]
    fn plain_search_is_literal_and_case_insensitive_by_default() {
        let re = build_pattern("a.b", PLAIN).unwrap();
        let (lines, total, _) = grep_text(&re, "A.B and axb\nnone\na.b a.b", 10);
        assert_eq!(total, 3);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line, 1);
        assert_eq!(lines[0].ranges, vec![[0, 3]]);
        assert_eq!(lines[1].ranges, vec![[0, 3], [4, 7]]);
    }

    #[test]
    fn case_sensitive_and_regex() {
        let cs = GrepOptions {
            case_sensitive: true,
            regex: false,
            whole_word: false,
        };
        let (_, total, _) = grep_text(&build_pattern("Note", cs).unwrap(), "Note note NOTE", 10);
        assert_eq!(total, 1);

        let rx = GrepOptions {
            case_sensitive: false,
            regex: true,
            whole_word: false,
        };
        let re = build_pattern(r"todo-(\d+)", rx).unwrap();
        let (lines, total, _) = grep_text(&re, "TODO-12 and todo-3", 10);
        assert_eq!(total, 2);
        assert_eq!(lines[0].ranges, vec![[0, 7], [12, 18]]);
    }

    #[test]
    fn whole_word_uses_unicode_boundaries() {
        let ww = GrepOptions {
            whole_word: true,
            ..PLAIN
        };
        let count = |q: &str, opts: GrepOptions, text: &str| {
            grep_text(&build_pattern(q, opts).unwrap(), text, 10).1
        };
        assert_eq!(count("note", ww, "note notebook a_note note."), 2);
        assert_eq!(count("ghi", ww, "ghi chú, ghichú, ghi"), 2);
        // A side that is not a word character gets no boundary: "#tag" still matches.
        assert_eq!(count("#tag", ww, "x #tag, y#tag #tags"), 2);
        let rx = GrepOptions { regex: true, ..ww };
        // The whole alternation is bounded, not just its ends.
        assert_eq!(count("cat|dog", rx, "cat dog concat dogma"), 2);
    }

    #[test]
    fn ranges_are_utf16_offsets() {
        let re = build_pattern("ghi", PLAIN).unwrap();
        let (lines, _, _) = grep_text(&re, "🙂 Việt ghi chú", 10);
        // "🙂" is 2 UTF-16 units; "Việt" 4.
        assert_eq!(lines[0].ranges, vec![[8, 11]]);
        let text: Vec<u16> = lines[0].text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&text[8..11]).unwrap(), "ghi");
    }

    #[test]
    fn invalid_and_empty_matching_patterns_are_rejected() {
        let rx = GrepOptions {
            case_sensitive: false,
            regex: true,
            whole_word: false,
        };
        assert!(build_pattern("(", rx).is_err());
        assert!(build_pattern("a*", rx).is_err());
        assert!(build_pattern("", PLAIN).is_err());
        assert!(build_pattern("a+", rx).is_ok());
    }

    #[test]
    fn max_lines_limits_lines_not_total() {
        let re = build_pattern("x", PLAIN).unwrap();
        let (lines, total, matching) = grep_text(&re, "x\nx\nx x", 2);
        assert_eq!(lines.len(), 2);
        assert_eq!(total, 4);
        assert_eq!(matching, 3);
    }

    #[test]
    fn long_lines_are_shortened() {
        let re = build_pattern("end", PLAIN).unwrap();
        let line = format!("{} end", "a".repeat(500));
        let (lines, total, _) = grep_text(&re, &line, 10);
        assert_eq!(total, 1);
        assert!(lines[0].text.ends_with('…'));
        assert!(lines[0].ranges.is_empty(), "match beyond the shown text");
    }

    #[test]
    fn replace_plain_is_literal_and_keeps_line_endings() {
        let re = build_pattern("$x", PLAIN).unwrap();
        let (out, n) = replace_text(&re, "a $x\r\nb $X $x\nc", "$1y", PLAIN);
        assert_eq!(out, "a $1y\r\nb $1y $1y\nc");
        assert_eq!(n, 3);
    }

    #[test]
    fn replace_regex_expands_groups_and_matches_preview_count() {
        let rx = GrepOptions {
            case_sensitive: true,
            regex: true,
            whole_word: false,
        };
        let re = build_pattern(r"(\w+)@old", rx).unwrap();
        let text = "a@old b@old\nc@new\nd@old";
        let (_, previewed, _) = grep_text(&re, text, 100);
        let (out, n) = replace_text(&re, text, "$1@new", rx);
        assert_eq!(out, "a@new b@new\nc@new\nd@new");
        assert_eq!(n, previewed);
        // A pattern that could span lines only applies within each line.
        let nl = build_pattern(r"old\s+d", rx).unwrap();
        assert_eq!(replace_text(&nl, text, "X", rx).1, 0);
    }
}
