# CAS-TX promotion

Fieldboard is promoted at https://cas-tx.com/Dashboard and in the CAS-TX open-source catalog. The product page links to this public repository and self-hosting instructions. It is a marketing page, not a hosted customer workspace.

The November 26, 2026 release added the product page, its isolated assets, the catalog card and a sitemap entry. Publication was verified against the prepared file hashes. The eight retained public routes checked before/after, including Bidlark, returned identical response bodies; the checked application service PIDs stayed unchanged. The newly published CAS FieldOps route and catalog entry were preserved.

The first activation attempt stopped because another release had added a FieldOps route after the configuration snapshot. The release was regenerated from fresh live evidence before activation. The final public sitemap retained all 52 existing URLs and added the Fieldboard page.

`promotion/Dashboard/` holds the product-page source and a screenshot with synthetic QA data. `scripts/prepare-promotion.py` builds a scoped static release from a captured live Caddy configuration, catalog page and sitemap. It does not deploy or manage credentials. Live hosting evidence and configuration backups are deliberately excluded from this public repository.

The current Fieldboard handler owns `/Dashboard`, its named assets, `/open-source` aliases and `/sitemap.xml`. Future catalog or sitemap releases must inspect the current live routing and preserve entries from other products; updating an older static directory alone may no longer change the served catalog. Never overwrite a live routing configuration prepared against a different checksum.
