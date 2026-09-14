# docs/ai — AI Context

Progressive-loading context for AI agents. Load the smallest useful set.

## Loading Order

```
1. AGENTS.md                        always
2. AI_RULES.md                      when changing code
3. docs/ai/PROJECT_MAP.md           to locate files
4. docs/ai/<SUBSYSTEM>.md           only the subsystem you touch
5. Actual source code               authoritative
6. Verify (docs/ai/TESTING.md) → update AI_Handoff.md
```

## Files

| File | When to load |
|------|-------------|
| `PROJECT_MAP.md` | Need to find where something lives |
| `ARCHITECTURE.md` | Need system-level understanding |
| `WORKFLOW.md` | Git / Freebuff push / deployment |
| `DATABASE.md` | Any schema/migration/DB change |
| `AUTH.md` | Login, session, OAuth, roles |
| `PRODUCTS.md` | Catalog, product CRUD, variants, search |
| `CATEGORIES.md` | Category taxonomy, tree, validation |
| `SELLER.md` | Seller onboarding, shop, seller APIs |
| `CUSTOMER.md` | Customer profile, cart, wishlist, addresses |
| `CHECKOUT.md` | Orders, payments, shipments |
| `MEDIA.md` | R2 uploads, images, media |
| `REALTIME.md` | WebSocket, channels, broadcasts |
| `DESIGN.md` | Styling, theme, responsive, i18n |
| `TESTING.md` | How to verify changes |
| `TROUBLESHOOTING.md` | Real failure modes and fixes |
| `history/README.md` | Only when historical context is needed |

## Rule

Historical files in `history/` are **reference only**. Do not load them automatically. Read the current subsystem doc + source first; expand only when dependency tracing requires it.
