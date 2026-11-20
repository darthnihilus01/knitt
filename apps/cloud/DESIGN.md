# Knitt editorial product interface

Reference: https://getdesign.md/cohere/design-md

Use a full-width white canvas, deep green product headers, warm stone surfaces,
restrained coral labels and thin gray rules. This replaces the catalog theme.

`public/style.css` supplies layout mechanics and shared components.
`public/cohere.css` supplies the active light theme; load it after the base sheet.

- Keep Knitt's name, icon, account data and product functionality.
- Use regular-weight display type with a technical, near-monospaced character.
  Proprietary Cohere fonts are not bundled. Use the declared system fallbacks;
  do not add font URLs that CSP cannot load.
- Use system sans-serif for readable body text and dense UI.
- Primary actions are near-black pills; dark headers use white pills.
- Major panels use 16–22px corners. Conversation lists use rules, not tiled cards.
- Admin metrics use stone surfaces and tabular numbers; user tables scroll within
  their container. Preserve visible focus, form errors, sync warnings and access checks.
- Do not cap the page width or reintroduce black framing. Keep mobile controls at
  least 44px tall and retain reduced-motion support.
- Use flat fills and subtle borders, without decorative shadows or gradients.
