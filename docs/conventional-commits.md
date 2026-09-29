# Conventional Commits

Every commit in this repository must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

Use this format:

```text
<type>(optional scope): short imperative description
```

Examples:

```text
feat(library): add an installed-title filter
fix(ftp): preserve nested upload paths
docs: clarify the integration workflow
chore(deps): update Vite
```

Choose an accurate type, keep the description concise and imperative, and do not end it with a period.

Release Please uses commit messages to determine release versions and generate changelog entries. Commits that do not follow this convention can produce incomplete or incorrect release notes.
