//! Fuzzy filename matching for the Quick Switcher, ported from
//! github.com/sahilm/fuzzy v0.1.3 (used by the Go build) so result ranking
//! stays identical. Scoring rewards first-character, camelCase, after-separator
//! and adjacent matches, and penalizes unmatched characters.

const FIRST_CHAR_MATCH_BONUS: i64 = 10;
const MATCH_FOLLOWING_SEPARATOR_BONUS: i64 = 20;
const CAMEL_CASE_MATCH_BONUS: i64 = 20;
const ADJACENT_MATCH_BONUS: i64 = 5;
const UNMATCHED_LEADING_CHAR_PENALTY: i64 = -5;
const MAX_UNMATCHED_LEADING_CHAR_PENALTY: i64 = -15;

const SEPARATORS: [char; 6] = ['/', '-', '_', ' ', '.', '\\'];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub index: usize,
    pub score: i64,
}

/// Returns the entries of `data` matching `pattern`, best match first (stable
/// for equal scores).
pub fn find(pattern: &str, data: &[String]) -> Vec<Match> {
    let pattern: Vec<char> = pattern.chars().collect();
    if pattern.is_empty() {
        return Vec::new();
    }
    let mut matches: Vec<Match> = data
        .iter()
        .enumerate()
        .filter_map(|(index, s)| score(&pattern, s).map(|score| Match { index, score }))
        .collect();
    matches.sort_by(|a, b| b.score.cmp(&a.score));
    matches
}

/// Scores one candidate; `None` when not every pattern character matched.
/// Indexes are byte offsets, as in the Go original.
fn score(pattern: &[char], s: &str) -> Option<i64> {
    let s = s.split('\0').next().unwrap_or("");
    let chars: Vec<(usize, char)> = s.char_indices().collect();

    let mut total: i64 = 0;
    let mut matched: Vec<usize> = Vec::with_capacity(pattern.len());
    let mut pattern_index = 0;
    let mut best_score: i64 = -1;
    let mut matched_index: i64 = -1;
    let mut curr_adjacent_bonus: i64 = 0;
    let mut last = '\0';
    let mut last_index = 0usize;

    for (pos, &(j, candidate)) in chars.iter().enumerate() {
        if equal_fold(candidate, pattern[pattern_index]) {
            let mut score = 0;
            if j == 0 {
                score += FIRST_CHAR_MATCH_BONUS;
            }
            if last.is_lowercase() && candidate.is_uppercase() {
                score += CAMEL_CASE_MATCH_BONUS;
            }
            if j != 0 && SEPARATORS.contains(&last) {
                score += MATCH_FOLLOWING_SEPARATOR_BONUS;
            }
            if let Some(&last_match) = matched.last() {
                let bonus = if last_match == last_index {
                    curr_adjacent_bonus * 2 + ADJACENT_MATCH_BONUS
                } else {
                    0
                };
                score += bonus;
                curr_adjacent_bonus += bonus;
            }
            if score > best_score {
                best_score = score;
                matched_index = j as i64;
            }
        }

        let next_p = pattern.get(pattern_index + 1).copied().unwrap_or('\0');
        let next_c = chars.get(pos + 1).map_or('\0', |&(_, c)| c);
        if (equal_fold(next_p, next_c) || next_c == '\0') && matched_index > -1 {
            if matched.is_empty() {
                let penalty = matched_index * UNMATCHED_LEADING_CHAR_PENALTY;
                best_score += penalty.max(MAX_UNMATCHED_LEADING_CHAR_PENALTY);
            }
            total += best_score;
            matched.push(matched_index as usize);
            best_score = -1;
            pattern_index += 1;
        }
        last_index = j;
        last = candidate;
    }

    // Penalty for each unmatched character (in bytes, like the original).
    total += matched.len() as i64 - s.len() as i64;
    (matched.len() == pattern.len()).then_some(total)
}

fn equal_fold(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranked(pattern: &str, data: &[&str]) -> Vec<String> {
        let data: Vec<String> = data.iter().map(|s| s.to_string()).collect();
        find(pattern, &data)
            .into_iter()
            .map(|m| data[m.index].clone())
            .collect()
    }

    #[test]
    fn matches_subsequence_case_insensitively() {
        assert_eq!(
            ranked("rdmp", &["projects/roadmap.md", "daily/2024-01-01.md"]),
            ["projects/roadmap.md"]
        );
        assert_eq!(ranked("RDM", &["roadmap.md"]), ["roadmap.md"]);
        assert!(ranked("xyz", &["roadmap.md"]).is_empty());
        assert!(ranked("", &["roadmap.md"]).is_empty());
    }

    // Reference results generated with github.com/sahilm/fuzzy v0.1.3 (Go)
    // over REFERENCE_DATA: (pattern, matched string, score), best first.
    const REFERENCE_DATA: &[&str] = &[
        "cartographer.go",
        "main.go",
        "fuzzy/fuzzy_test.go",
        "FuzzyMatch.md",
        "notes/fuzzy.md",
        "projects/roadmap.md",
        "daily/2024-01-01.md",
        "Ghi chú/họp tuần.md",
        "README.md",
        "src/QuickSwitcher.tsx",
    ];
    const GO_RESULTS: &[(&str, &str, i64)] = &[
        ("fuzzy", "FuzzyMatch.md", 202),
        ("fuzzy", "fuzzy/fuzzy_test.go", 196),
        ("fuzzy", "notes/fuzzy.md", 196),
        ("fm", "FuzzyMatch.md", 19),
        ("fm", "notes/fuzzy.md", 13),
        ("md", "README.md", 3),
        ("md", "notes/fuzzy.md", -2),
        ("md", "FuzzyMatch.md", -6),
        ("md", "projects/roadmap.md", -7),
        ("md", "daily/2024-01-01.md", -7),
        ("md", "Ghi chú/họp tuần.md", -12),
        ("rdmp", "projects/roadmap.md", -5),
        ("qs", "src/QuickSwitcher.tsx", 6),
        ("họp", "Ghi chú/họp tuần.md", 4),
        ("2024", "daily/2024-01-01.md", 55),
        ("readme", "README.md", 612),
    ];

    #[test]
    fn scores_and_order_match_go_implementation() {
        let data: Vec<String> = REFERENCE_DATA.iter().map(|s| s.to_string()).collect();
        let patterns = ["fuzzy", "fm", "md", "rdmp", "qs", "họp", "2024", "readme"];
        let got: Vec<(&str, &str, i64)> = patterns
            .iter()
            .flat_map(|p| {
                find(p, &data)
                    .into_iter()
                    .map(|m| (*p, REFERENCE_DATA[m.index], m.score))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert_eq!(got, GO_RESULTS);
    }
}
