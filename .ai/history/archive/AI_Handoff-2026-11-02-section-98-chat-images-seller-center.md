# §98. Chat images in VelSeller + VelCenter (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 to keep the live handoff under
> this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §98. Chat images in VelSeller + VelCenter (2026-10-31) — PARTIAL

**Report:** [`.ai/history/2026-10-31-chat-image-ui-seller-center.md`](./history/2026-10-31-chat-image-ui-seller-center.md).

VelSeller gained the same composer flow as VelShop (upload before send, progress, remove, retry,
image-only); VelCenter now **renders** image messages in the bubble with the shared viewer. All three
surfaces use one upload path and one viewer — no duplicate storage or upload system.

Still missing from the reference: VelCenter's own composer, conversation search, All/Unread/Support
filters, and real presence (no presence event exists — must not be faked). Browser E2E remains blocked on
credentials.

Verified: typecheck 4/4, build 4/4, i18n 1268, backend suite 1113 pass / 8 Termux-only fails, diff clean.

---

**Note on this file's size:** the ~55 KB edit-tool ceiling is real. §69 was archived on 2026-10-26;
§76/§79 and §80/§81 on 2026-10-27; the 2026-10-04 payment-integrity narrative on 2026-10-27 with
§83; §82 on 2026-10-28 with §84; §78 + §83 on 2026-10-30 with §85; §84 + §85 on 2026-10-30 with §87; and
§86 + §87 on 2026-10-31 with §89; §88 on 2026-10-31 with §91; §89 on 2026-10-31 with §92; §90 on 2026-10-31 with §93; §91 on 2026-10-31 with §94; §92 on 2026-10-31 with §95; §93 on 2026-11-01 with §98; §94 on 2026-11-01 with §99; §95 on 2026-11-02 with §100; §96 + §97 on 2026-11-02 with §101
(all verbatim + index row). Before appending again, archive the next-longest closed block the same way.
Archiving is not deletion: the text is preserved verbatim.
