# Git Word-Level & Character-Level Diffs

Research into how Git can show diffs within a single line, rather than just marking entire lines as changed. Relevant for building track-changes / revision features in a Markdown editor.

## Word-Level Diffs

The most common way to view changes within a line:

### `--word-diff`

```bash
git diff --word-diff
```

Displays changed words inline, wrapping removed text in `[-...-]` and added text in `{+...+}`.

### `--color-words`

```bash
git diff --color-words
```

Uses only color (red for removed, green for added) to show changes within the same line. No bracket markers — cleaner output.

### Character-Level Diff

```bash
git diff --word-diff-regex=.
```

Forces Git to treat every single character as a "word," giving character-level diffs.

### Best for Prose/Markdown

```bash
git diff --word-diff=color --word-diff-regex='[^[:space:]]'
```

Highlights every non-space character change — catches even tiny typo changes like "than" to "then".

## Enhancing Standard Diffs

### diff-highlight

A script bundled with Git (in the `contrib` folder) that adds character-level highlighting to standard `git diff` output.

```bash
git config --global pager.diff 'diff-highlight | less'
```

### Delta (git-delta)

A popular third-party tool that provides syntax highlighting and word-level diffing in the terminal. More polished than diff-highlight.

### GitLens (VS Code)

Provides line-by-line history, blame annotations, and visual comparison of any two points in a document's history.

## Using Git as a Document Reviewer

### History Review

```bash
git log -p --word-diff
```

Scrollable history of every word-level change ever made to a document.

### Compare Files Outside a Repo

```bash
git diff --no-index --word-diff file1.txt file2.txt
```

Works on arbitrary files, no Git repo needed.

### Interactive Accept/Reject

```bash
git add -p
```

Interactively "accept" or "reject" specific hunks before committing — similar to accepting suggestions in Word.

## Git-Backed Track Changes Editors (Prior Art)

| Tool | Approach | Notes |
|------|----------|-------|
| **HackMD** | Collaborative Markdown editor with GitHub integration | Pull/push between docs and Git repos |
| **Manubot** | Scientific manuscripts | Git tracks every change, auto-converts Markdown to PDF/Word |
| **GitBook** | Documentation platform | Git-like versioning with branches and "change requests" |
| **ProseMirror Track Changes** | Editor toolkit plugins | Community plugins for insertions, deletions, comments — serializable to Git |
| **CriticMarkup** | Markup syntax for editorial changes | `{++addition++}`, `{--deletion--}`, `{~~old~>new~~}`, `{>>comment<<}` |

## Key Challenges for a Git-Backed Editor

1. **Line vs. Word Tracking**: Standard Git tracks line-by-line. One word edit in a long soft-wrapped paragraph marks the entire paragraph as changed.
2. **Metadata Storage**: Git doesn't natively store "who suggested this" or "comments on this word" without extra layers (e.g., CriticMarkup, custom metadata).
3. **Merge Conflicts in Prose**: Git's merge strategies are optimized for code (line-based), not prose (paragraph-based). Long paragraphs on single lines create painful merges.

## Implications for Markdown Reader

- Could use `--word-diff` output format to render inline track changes
- CriticMarkup is worth investigating as a native Markdown-compatible track changes syntax
- ProseMirror's track changes model could inform a web-based editing approach
- For comparing document versions, `git diff --no-index --word-diff` works without needing a repo

## References

- [Stack Overflow: git diff show changed part in line](https://stackoverflow.com/questions/49278577/git-diff-show-changed-part-in-the-line)
- [DEV Community: Git Diff --word-diff](https://dev.to/iamrj846/git-diff-word-diff-see-word-level-changes-not-just-lines-4d82)
- [CriticMarkup Spec](https://criticmarkup.com/)
- [git-delta](https://github.com/dandavison/delta)
